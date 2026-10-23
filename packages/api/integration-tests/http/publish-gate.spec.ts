import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { adminHeaders, vendorHeaders } from "../helpers/auth"
import { groceryVendor as groceryVendorOf, offerOn as offerOnProduct } from "../helpers/offers"

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
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
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

    const groceryVendor = () => groceryVendorOf(getContainer(), api)
    const offerOn = (product: { id: string }) => offerOnProduct(getContainer(), api, product)

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
        expect(message).toContain("Image")
        expect(message).toContain("Category")
        expect(message).toContain("Weight")
        expect(message).not.toContain("Title")
        // A shop's offer prices a product; buyers only see priced offers, so publishing doesn't wait for one.
        expect(message).not.toContain("Selling price")

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "product", fields: ["id"], filters: { title: "Bare product" } })
        expect(data).toHaveLength(0)
      })

      it("refuses to publish an incomplete draft through the batch endpoint", async () => {
        const { data } = await api.post(
          "/admin/products",
          { title: "Batch beans", status: "draft", categories: [{ id: await categoryId("Beans & Garri") }] },
          admin
        )

        const message = await refusal(
          api.post("/admin/products/batch", { update: [{ id: data.product.id, status: "published" }] }, admin)
        )
        expect(message).toContain("Image")

        const { data: after } = await api.get(`/admin/products/${data.product.id}`, admin)
        expect(after.product.status).toBe("draft")
      })

      it("publishes a complete product before any shop has priced it, so shops can find it to offer", async () => {
        // Mercur master products carry no price of their own: a shop's offer sets it.
        const { data } = await api.post(
          "/admin/products",
          { ...(await completeGrocery(await categoryId("Rice & Grains"))), status: "draft" },
          admin
        )

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
        expect(message).toContain("Image")
        const { data: still } = await api.get(`/admin/products/${data.product.id}`, admin)
        expect(still.product.status).toBe("proposed")

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
        expect(after.categories?.length).toBeGreaterThan(0)
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

    describe("category shipping defaults on a later category", () => {
      const uncategorised = async (title: string, extra: Record<string, unknown> = {}) => {
        const { data } = await api.post("/admin/products", { title, status: "draft", ...extra }, admin)
        return data.product as { id: string }
      }
      const shipping = async (id: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({
          entity: "product",
          fields: ["weight", "length", "width", "height", "metadata"],
          filters: { id },
        })
        return {
          weight: product.weight === null ? null : Number(product.weight),
          dims: [product.length, product.width, product.height].map((v: unknown) => (v === null ? null : Number(v))),
          package_category: (product.metadata as Record<string, unknown> | null)?.package_category ?? null,
        }
      }

      it("fills what an operator's update leaves blank when it adds a category, keeping the product's own values", async () => {
        const product = await uncategorised("Torch", { weight: 250 })
        expect(await shipping(product.id)).toEqual({ weight: 250, dims: [null, null, null], package_category: null })

        await api.post(`/admin/products/${product.id}`, { categories: [{ id: await categoryId("Power & Lighting") }] }, admin)

        expect(await shipping(product.id)).toEqual({ weight: 250, dims: [35, 30, 25], package_category: "electronics" })
      })

      it("fills them through the batch endpoint", async () => {
        const product = await uncategorised("Head Wrap")
        await api.post(
          "/admin/products/batch",
          { update: [{ id: product.id, categories: [{ id: await categoryId("Bags & Accessories") }] }] },
          admin
        )
        expect(await shipping(product.id)).toEqual({ weight: 350, dims: [40, 35, 8], package_category: "fashion" })
      })

      it("fills them when a vendor's change request adding the category is confirmed", async () => {
        const vendor = await groceryVendor()
        const { data } = await api.post(
          "/vendor/products",
          { title: "Suya Spice 100g", variants: [{ title: "Suya Spice 100g", sku: "SUYA-100G" }] },
          vendor
        )
        const { data: change } = await api.post(
          `/vendor/products/${data.product.id}`,
          { categories: [{ id: await categoryId("Oils & Spices") }] },
          vendor
        )
        expect((await shipping(data.product.id)).weight).toBeNull()

        await api.post(`/admin/product-changes/${change.product_change.id}/confirm`, {}, admin)

        expect(await shipping(data.product.id)).toEqual({ weight: 1000, dims: [30, 20, 15], package_category: "groceries" })
      })

      it("leaves them unset when the update is refused by the publish gate", async () => {
        const product = await uncategorised("Extension Box")
        await refusal(
          api.post(
            `/admin/products/${product.id}`,
            { categories: [{ id: await categoryId("Power & Lighting") }], status: "published" },
            admin
          )
        )
        expect(await shipping(product.id)).toEqual({ weight: null, dims: [null, null, null], package_category: null })
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
        // Title, category and weight (a category default) pass; image and Storage do not.
        expect(data.completeness).toMatchObject({ product_id: product.id, score: 60, is_complete: false })
        expect(data.completeness.missing).toEqual([
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

      it("reports a vendor its product as its pending change request would leave it, and says so", async () => {
        const vendor = await groceryVendor()
        const { data } = await api.post(
          "/vendor/products",
          { title: "Tiger Nuts 500g", variants: [{ title: "Tiger Nuts 500g", sku: "TIGER-NUTS-500G" }] },
          vendor
        )
        const { data: before } = await api.get(`/vendor/products/${data.product.id}/completeness`, vendor)
        expect(before.pending_change).toBeNull()
        expect(before.completeness.missing.map((m: { label: string }) => m.label)).toEqual([
          "Image",
          "Category",
          "Weight",
        ])

        const { data: change } = await api.post(
          `/vendor/products/${data.product.id}`,
          {
            categories: [{ id: await categoryId("Snacks & Drinks") }],
            images: [{ url: "https://placehold.co/800x800/png?text=Tiger+Nuts" }],
          },
          vendor
        )

        const { data: after } = await api.get(`/vendor/products/${data.product.id}/completeness`, vendor)
        expect(after.pending_change).toEqual({ id: change.product_change.id })
        // Category, image and (from the category's defaults) weight are covered by
        // the pending change; the category brings its required Storage attribute.
        expect(after.completeness.missing.map((m: { label: string }) => m.label)).toEqual(["Storage"])

        // The operator still sees the product as stored.
        const { data: stored } = await api.get(`/admin/products/${data.product.id}/completeness`, admin)
        expect(stored.completeness.missing.map((m: { label: string }) => m.label)).toContain("Category")
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
