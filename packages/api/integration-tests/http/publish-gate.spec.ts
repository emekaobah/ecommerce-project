import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { adminHeaders, vendorHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let admin: { headers: Record<string, string> }

    const categoryId = async (name: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "product_category", fields: ["id"], filters: { name } })
      return data[0].id as string
    }

    // Seeded once; the runner restores this snapshot before every test.
    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      admin = await adminHeaders(getContainer(), api)
    })

    /** A seeded starter attribute, with its select values by name. */
    const attribute = async (handle: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product_attribute",
        fields: ["id", "name", "values.id", "values.name"],
        filters: { handle, product_id: null } as any,
      })
      const found = data[0] as { id: string; name: string; values: { id: string; name: string }[] }
      return { ...found, valueId: (name: string) => found.values.find((v) => v.name === name)!.id }
    }

    const storedCool = async () => {
      const storage = await attribute("storage")
      return { id: storage.id, value_ids: [storage.valueId("Cool, dry place")] }
    }

    const completeGrocery = async (category: string, title = "Yam Flour 1kg") => ({
      title,
      categories: [{ id: category }],
      attributes: [await storedCool()],
      images: [{ url: "https://placehold.co/800x800/png?text=Yam+Flour" }],
      weight: 1000,
      variants: [{ title, sku: title.toUpperCase().replace(/\W+/g, "-") }],
    })

    /** Request config for the seeded grocery shop's owner. */
    const groceryVendor = async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const shop = SEED_SELLERS[0]
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return vendorHeaders(api, shop.owner.email, SEED_PASSWORD, seller.id)
    }

    /** The grocery shop lists every variant of the product at ₦3,500. */
    const offerOn = async (product: { id: string }) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [profile] } = await query.graph({
        entity: "shipping_profile",
        fields: ["id"],
        filters: { name: "Marketplace Shipping" },
      })
      const { data: [full] } = await query.graph({ entity: "product", fields: ["variants.id"], filters: { id: product.id } })
      const vendor = await groceryVendor()
      for (const variant of full.variants as { id: string }[]) {
        const sku = `OFFER-${variant.id}`
        await api.post(
          "/vendor/offers",
          {
            sku,
            variant_id: variant.id,
            shipping_profile_id: profile.id,
            inventory_items: [{ sku }],
            prices: [{ amount: 3500, currency_code: "ngn" }],
          },
          vendor
        )
      }
    }

    const refusal = async (request: Promise<unknown>) => {
      const error = await request.then(
        () => {
          throw new Error("expected the request to be refused")
        },
        (e: any) => e
      )
      expect(error.response?.status).toBe(400)
      return error.response.data.message as string
    }

    describe("publish gate", () => {
      it("refuses to create a published product that is missing required fields, listing them", async () => {
        const message = await refusal(
          api.post("/admin/products", { title: "Bare product", status: "published" }, admin)
        )
        expect(message).toContain("Selling price")
        expect(message).toContain("Image")
        expect(message).toContain("Category")
        expect(message).toContain("Weight")
        expect(message).not.toContain("Title")

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "product", fields: ["id"], filters: { title: "Bare product" } })
        expect(data).toHaveLength(0)
      })

      it("publishes a complete product", async () => {
        // Mercur master products carry no price of their own: a shop's offer sets it.
        const { data } = await api.post(
          "/admin/products",
          { ...(await completeGrocery(await categoryId("Rice & Grains"))), status: "draft" },
          admin
        )
        await offerOn(data.product)

        const { data: published } = await api.post(`/admin/products/${data.product.id}`, { status: "published" }, admin)
        expect(published.product.status).toBe("published")
      })

      it("refuses to publish an incomplete draft through an update, leaving it a draft", async () => {
        const { data } = await api.post(
          "/admin/products",
          { title: "Draft beans", status: "draft", categories: [{ id: await categoryId("Beans & Garri") }] },
          admin
        )
        expect(data.product.status).toBe("draft")

        const message = await refusal(api.post(`/admin/products/${data.product.id}`, { status: "published" }, admin))
        expect(message).toContain("Selling price")
        expect(message).toContain("Image")
        expect(message).not.toContain("Category")

        const { data: after } = await api.get(`/admin/products/${data.product.id}`, admin)
        expect(after.product.status).toBe("draft")
      })

      it("refuses to approve an incomplete vendor proposal until it is complete", async () => {
        const vendor = await groceryVendor()
        const { data } = await api.post(
          "/vendor/products",
          {
            title: "Agege Bread",
            categories: [{ id: await categoryId("Snacks & Drinks") }],
            attributes: [await storedCool()],
            variants: [{ title: "Agege Bread", sku: "AGEGE-BREAD" }],
          },
          vendor
        )
        expect(data.product.status).toBe("proposed")

        const message = await refusal(api.post(`/admin/products/${data.product.id}/confirm`, {}, admin))
        expect(message).toContain("Selling price")
        expect(message).toContain("Image")
        const { data: still } = await api.get(`/admin/products/${data.product.id}`, admin)
        expect(still.product.status).toBe("proposed")

        await offerOn(data.product)
        await api.post(
          `/admin/products/${data.product.id}`,
          { images: [{ url: "https://placehold.co/800x800/png?text=Bread" }] },
          admin
        )

        const { data: confirmed } = await api.post(`/admin/products/${data.product.id}/confirm`, {}, admin)
        expect(confirmed.product.status).toBe("published")
      })
    })

    describe("edits to published products", () => {
      it("refuses an operator edit that would leave a published product incomplete, keeping it intact", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: "ofada-rice-5kg" } })

        const message = await refusal(
          api.post(`/admin/products/${product.id}`, { images: [], thumbnail: null, categories: [] }, admin)
        )
        expect(message).toContain("Image")
        expect(message).toContain("Category")

        const { data: [after] } = await query.graph({
          entity: "product",
          fields: ["status", "thumbnail", "images.id", "categories.id"],
          filters: { id: product.id },
        })
        expect(after.status).toBe("published")
        expect(after.thumbnail).toBeTruthy()
        expect(after.images.length).toBeGreaterThan(0)
        expect(after.categories.length).toBeGreaterThan(0)
      })
    })

    describe("vendor change requests", () => {
      it("refuses to apply a vendor's edit that would leave a published product incomplete", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: "ofada-rice-5kg" } })

        const { data } = await api.post(
          `/vendor/products/${product.id}`,
          { images: [], thumbnail: null },
          await groceryVendor()
        )
        const message = await refusal(api.post(`/admin/product-changes/${data.product_change.id}/confirm`, {}, admin))
        expect(message).toContain("Image")

        const { data: [after] } = await query.graph({
          entity: "product",
          fields: ["status", "images.id"],
          filters: { id: product.id },
        })
        expect(after.status).toBe("published")
        expect(after.images.length).toBeGreaterThan(0)
      })
    })

    describe("required category attributes", () => {
      const fashionDraft = async () => {
        const { data } = await api.post(
          "/admin/products",
          {
            title: "Agbada Set",
            status: "draft",
            categories: [{ id: await categoryId("Men's Clothing") }],
            images: [{ url: "https://placehold.co/800x800/png?text=Agbada" }],
            variants: [{ title: "Agbada Set", sku: "AGBADA-SET" }],
          },
          admin
        )
        await offerOn(data.product)
        return data.product as { id: string }
      }

      it("refuses to publish a product missing a required attribute of its category", async () => {
        const product = await fashionDraft()

        const message = await refusal(api.post(`/admin/products/${product.id}`, { status: "published" }, admin))
        expect(message).toContain("Fabric")
        // Optional attributes, and other departments' attributes, are not demanded.
        expect(message).not.toContain("Care instructions")
        expect(message).not.toContain("Storage")
        expect(message).not.toContain("Voltage")
        expect(message).not.toContain("Weight")
      })

      it("refuses to remove a required attribute from a published product", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: "adire-kaftan" } })
        const fabric = await attribute("fabric")

        const message = await refusal(
          api.post(`/admin/products/${product.id}/attributes/batch`, { remove: [fabric.id] }, admin)
        )
        expect(message).toContain("Fabric")

        const { data } = await api.get(`/admin/products/${product.id}/completeness`, admin)
        expect(data.completeness.is_complete).toBe(true)
      })

      it("publishes once the required attribute has a value", async () => {
        const product = await fashionDraft()
        const fabric = await attribute("fabric")
        await api.post(
          `/admin/products/${product.id}/attributes/batch`,
          { add: [{ id: fabric.id, value_ids: [fabric.valueId("Cotton")] }] },
          admin
        )

        const { data } = await api.post(`/admin/products/${product.id}`, { status: "published" }, admin)
        expect(data.product.status).toBe("published")
      })
    })

    describe("category shipping defaults", () => {
      it("fills a new product's missing shipping fields from its category, keeping the vendor's own", async () => {
        const { data } = await api.post(
          "/vendor/products",
          {
            title: "Solar Lamp",
            categories: [{ id: await categoryId("Power & Lighting") }],
            weight: 900,
            variants: [{ title: "Solar Lamp", sku: "SOLAR-LAMP" }],
          },
          await groceryVendor()
        )

        const { data: after } = await api.get(`/admin/products/${data.product.id}`, admin)
        expect(Number(after.product.weight)).toBe(900)
        expect([after.product.length, after.product.width, after.product.height].map(Number)).toEqual([35, 30, 25])
        expect(after.product.metadata?.package_category).toBe("electronics")
      })
    })

    describe("completeness", () => {
      const incompleteBeans = async () => {
        const { data } = await api.post(
          "/admin/products",
          { title: "Draft beans", status: "draft", categories: [{ id: await categoryId("Beans & Garri") }] },
          admin
        )
        return data.product as { id: string }
      }

      it("reports an operator the score and missing fields of a product", async () => {
        const product = await incompleteBeans()
        const storage = await attribute("storage")

        const { data } = await api.get(`/admin/products/${product.id}/completeness`, admin)
        // Title, category and weight (a category default) pass; price, image and Storage do not.
        expect(data.completeness).toMatchObject({ product_id: product.id, score: 50, is_complete: false })
        expect(data.completeness.missing).toEqual([
          { key: "selling_price", label: "Selling price" },
          { key: "image", label: "Image" },
          { key: `attribute:${storage.id}`, label: "Storage" },
        ])
      })

      it("scores a seeded product complete", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: "adire-kaftan" } })

        const { data } = await api.get(`/admin/products/${product.id}/completeness`, admin)
        expect(data.completeness).toMatchObject({ score: 100, is_complete: true, missing: [] })
      })

      it("reports a vendor the completeness of its own proposal, but not of another shop's", async () => {
        const vendor = await groceryVendor()
        const { data } = await api.post(
          "/vendor/products",
          {
            title: "Kilishi 200g",
            categories: [{ id: await categoryId("Snacks & Drinks") }],
            variants: [{ title: "Kilishi 200g", sku: "KILISHI-200G" }],
          },
          vendor
        )

        const { data: own } = await api.get(`/vendor/products/${data.product.id}/completeness`, vendor)
        expect(own.completeness.is_complete).toBe(false)
        expect(own.completeness.missing.map((m: { label: string }) => m.label)).toEqual([
          "Selling price",
          "Image",
          "Storage",
        ])

        const fashion = SEED_SELLERS[1]
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: fashion.owner.email } })
        const other = await vendorHeaders(api, fashion.owner.email, SEED_PASSWORD, seller.id)
        const error = await api.get(`/vendor/products/${data.product.id}/completeness`, other).catch((e: any) => e)
        expect(error.response?.status).toBe(404)
      })
    })
  },
})
