import { ExecArgs, MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  toHandle,
} from "@medusajs/framework/utils";
import {
  AttributeType,
  MercurModules,
  ProductStatus,
  SellerRole,
  type CreateOfferDTO,
  type CreateProductDTO,
} from "@mercurjs/types";
import {
  approveSellerWorkflow,
  createOffersWorkflow,
  createProductAttributesWorkflow,
  createProductsWorkflow,
  createSellerAccountWorkflow,
  createSellerMembersStep,
  createSellerShippingOptionsWorkflow,
  createSellerStockLocationsWorkflow,
  upsertMembersStep,
} from "@mercurjs/core/workflows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductCategoriesWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingProfilesWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  setAuthAppMetadataStep,
  updateSalesChannelsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  SEED_CATEGORIES,
  SEED_DELIVERY_FEE,
  SEED_PASSWORD,
  SEED_PRODUCTS,
  SEED_REGION,
  SEED_SALES_CHANNEL,
  SEED_SELLERS,
  SEED_SIZES,
  SEED_VAT,
  seedImageUrl,
  type SeedSeller,
} from "./seed-data";

// Seeds Oja's demo world (see seed-data.ts). Every section looks up what already
// exists and creates only what is missing, so the seed is safe to re-run.

// Adds a staff member to a shop without the invite round-trip: the member
// record, the login's actor link, and the membership with its role.
const addSeedStaffMemberWorkflow = createWorkflow(
  "oja-seed-add-staff-member",
  (input: {
    auth_identity_id: string;
    seller_id: string;
    role_id: string;
    email: string;
    first_name: string;
    last_name: string;
  }) => {
    const members = upsertMembersStep(
      transform({ input }, ({ input }) => [
        { email: input.email, first_name: input.first_name, last_name: input.last_name },
      ])
    );
    const member = transform({ members }, ({ members }) => members[0]);
    setAuthAppMetadataStep({
      authIdentityId: input.auth_identity_id,
      actorType: "member",
      value: member.id,
    });
    createSellerMembersStep(
      transform({ input, member }, ({ input, member }) => [
        { seller_id: input.seller_id, member_id: member.id, role_id: input.role_id, is_owner: false },
      ])
    );
    return new WorkflowResponse(member);
  }
);

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  logger.info("Seeding store, sales channel and publishable key...");
  const [store] = await container.resolve(Modules.STORE).listStores();
  const salesChannelId = await seedSalesChannel(container, store.default_sales_channel_id);
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: "Oja",
        supported_currencies: [{ currency_code: SEED_REGION.currency_code, is_default: true }],
        default_sales_channel_id: salesChannelId,
      },
    },
  });
  await seedPublishableKey(container, salesChannelId);

  logger.info("Seeding the Nigeria region and VAT...");
  await seedRegion(container);

  logger.info("Seeding categories and attributes...");
  const categoryIds = await seedCategories(container);
  const sizeAttribute = await seedSizeAttribute(container);

  const shippingProfileId = await seedShippingProfile(container);

  const sellers: SeededSeller[] = [];
  for (const config of SEED_SELLERS) {
    logger.info(`Seeding seller "${config.name}"...`);
    sellers.push(await seedSeller(container, config, salesChannelId, shippingProfileId));
  }

  logger.info("Seeding products...");
  const productsByHandle = await seedProducts(container, {
    createdBy: sellers[0].ownerMemberId,
    salesChannelId,
    categoryIds,
    sizeAttribute,
  });

  logger.info("Seeding offers...");
  const offerCount = await seedOffers(container, sellers, productsByHandle, shippingProfileId);

  const { data: regions } = await query.graph({ entity: "region", fields: ["id"] });
  logger.info(
    `Finished seeding: ${regions.length} region, ${sellers.length} sellers, ${productsByHandle.size} products, ${offerCount} offers.`
  );
}

// Medusa creates a default sales channel and publishable key when it first boots.
// The buyer app uses them: reuse (and name) them, creating them only when absent.
async function seedSalesChannel(
  container: MedusaContainer,
  defaultSalesChannelId: string | null | undefined
): Promise<string> {
  if (defaultSalesChannelId) {
    await updateSalesChannelsWorkflow(container).run({
      input: { selector: { id: defaultSalesChannelId }, update: { name: SEED_SALES_CHANNEL } },
    });
    return defaultSalesChannelId;
  }
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL);
  const [existing] = await salesChannelService.listSalesChannels({ name: SEED_SALES_CHANNEL });
  if (existing) return existing.id;
  const { result } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: SEED_SALES_CHANNEL }] },
  });
  return result[0].id;
}

async function seedPublishableKey(container: MedusaContainer, salesChannelId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  type Key = { id: string; token: string; sales_channels?: { id: string }[] };
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "sales_channels.id"],
    filters: { type: "publishable", revoked_at: null },
  });
  const keys = data as Key[];
  let key = keys.find((k) => k.sales_channels?.some((sc) => sc.id === salesChannelId)) ?? keys[0];
  if (!key) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: SEED_SALES_CHANNEL, type: "publishable", created_by: "" }] },
    });
    key = { id: result[0].id, token: result[0].token };
  }
  if (!key.sales_channels?.some((sc) => sc.id === salesChannelId)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [salesChannelId] },
    });
  }
  logger.info(`Buyer app publishable key (EXPO_PUBLIC_PUBLISHABLE_KEY): ${key.token}`);
}

async function seedRegion(container: MedusaContainer) {
  const regionService = container.resolve(Modules.REGION);
  const [existing] = await regionService.listRegions({ name: SEED_REGION.name });
  if (!existing) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            ...SEED_REGION,
            payment_providers: ["pp_system_default"],
            automatic_taxes: true,
            // Nigerian shelf prices include VAT.
            is_tax_inclusive: true,
          },
        ],
      },
    });
  }

  const taxService = container.resolve(Modules.TAX);
  const countries = SEED_REGION.countries;
  const existingTax = await taxService.listTaxRegions({ country_code: countries });
  const missing = countries.filter((c) => !existingTax.some((t) => t.country_code === c));
  if (missing.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missing.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
        default_tax_rate: { ...SEED_VAT },
      })),
    });
  }
}

async function seedCategories(container: MedusaContainer): Promise<Map<string, string>> {
  const productService = container.resolve(Modules.PRODUCT);
  const parents = Object.keys(SEED_CATEGORIES) as (keyof typeof SEED_CATEGORIES)[];
  const children = Object.values(SEED_CATEGORIES).flat();
  const existing = await productService.listProductCategories({ name: [...parents, ...children] });
  const idByName = new Map(existing.map((c) => [c.name, c.id]));

  const create = async (inputs: { name: string; rank: number; parent_category_id?: string }[]) => {
    if (!inputs.length) return;
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: inputs.map((c) => ({ ...c, is_active: true })) },
    });
    result.forEach((c) => idByName.set(c.name, c.id));
  };

  await create(
    parents.filter((name) => !idByName.has(name)).map((name) => ({ name, rank: parents.indexOf(name) }))
  );
  await create(
    parents.flatMap((parent) =>
      SEED_CATEGORIES[parent]
        .map((name, rank) => ({ name, rank, parent_category_id: idByName.get(parent)! }))
        .filter((c) => !idByName.has(c.name))
    )
  );
  return idByName;
}

type SizeAttribute = { id: string; values: { id: string; name: string }[] };

// A global Size attribute that is a variant axis, so sized products get a native
// Size option the store can filter on.
async function seedSizeAttribute(container: MedusaContainer): Promise<SizeAttribute> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const load = async () =>
    (
      await query.graph({
        entity: "product_attribute",
        fields: ["id", "values.id", "values.name"],
        filters: { handle: "size", product_id: null },
      })
    ).data[0] as SizeAttribute | undefined;

  const existing = await load();
  if (existing) return existing;
  await createProductAttributesWorkflow(container).run({
    input: {
      attributes: [
        {
          name: "Size",
          handle: "size",
          type: AttributeType.MULTI_SELECT,
          is_variant_axis: true,
          is_filterable: true,
          rank: 0,
          values: SEED_SIZES.map((name, rank) => ({ name, rank })),
        },
      ],
    },
  });
  return (await load())!;
}

// One marketplace-wide shipping profile shared by every seller's shipping options
// and offers, so cart refresh keeps per-seller shipping methods.
async function seedShippingProfile(container: MedusaContainer): Promise<string> {
  const fulfillmentService = container.resolve(Modules.FULFILLMENT);
  const [existing] = await fulfillmentService.listShippingProfiles({ name: "Marketplace Shipping" });
  if (existing) return existing.id;
  const { result } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: "Marketplace Shipping", type: "default" }] },
  });
  return result[0].id;
}

async function registerLogin(container: MedusaContainer, email: string): Promise<string> {
  const authService = container.resolve(Modules.AUTH);
  const { success, authIdentity } = await authService.register("emailpass", {
    body: { email, password: SEED_PASSWORD },
  });
  if (success && authIdentity) return authIdentity.id;
  const [identity] = await authService.listProviderIdentities({ entity_id: email, provider: "emailpass" });
  return identity.auth_identity_id!;
}

type SeededSeller = {
  id: string;
  config: SeedSeller;
  ownerMemberId: string;
  stockLocationId: string;
};

async function seedSeller(
  container: MedusaContainer,
  config: SeedSeller,
  salesChannelId: string,
  shippingProfileId: string
): Promise<SeededSeller> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const findMember = async (email: string) =>
    (await query.graph({ entity: "member", fields: ["id"], filters: { email } })).data[0] as
      | { id: string }
      | undefined;

  const { pickup } = config;
  const addressMetadata = {
    landmark: pickup.landmark,
    latitude: pickup.latitude,
    longitude: pickup.longitude,
  };

  const { data: [existingSeller] } = await query.graph({
    entity: "seller",
    fields: ["id"],
    filters: { email: config.owner.email },
  });
  let sellerId: string = existingSeller?.id;
  if (!sellerId) {
    const { result } = await createSellerAccountWorkflow(container).run({
      input: {
        auth_identity_id: await registerLogin(container, config.owner.email),
        member_email: config.owner.email,
        first_name: config.owner.first_name,
        last_name: config.owner.last_name,
        seller: {
          name: config.name,
          email: config.owner.email,
          currency_code: SEED_REGION.currency_code,
          description: config.description,
          logo: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(config.name)}`,
          banner: `https://picsum.photos/seed/${toHandle(config.name)}/1200/320`,
        },
        address: {
          first_name: config.owner.first_name,
          last_name: config.owner.last_name,
          company: config.name,
          address_1: pickup.address_1,
          city: pickup.city,
          province: pickup.province,
          country_code: "ng",
          phone: config.phone,
          metadata: addressMetadata,
        },
      },
    });
    await approveSellerWorkflow(container).run({ input: { seller_id: result.id } });
    sellerId = result.id;
  }

  const ownerMemberId = (await findMember(config.owner.email))!.id;

  if (!(await findMember(config.staff.email))) {
    await addSeedStaffMemberWorkflow(container).run({
      input: {
        ...config.staff,
        auth_identity_id: await registerLogin(container, config.staff.email),
        seller_id: sellerId,
        role_id: SellerRole.ORDER_MANAGEMENT,
      },
    });
  }

  const locationName = `${config.name} pickup`;
  const { data: [existingLocation] } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
    filters: { name: locationName },
  });
  if (existingLocation) {
    return { id: sellerId, config, ownerMemberId, stockLocationId: existingLocation.id };
  }

  const {
    result: [location],
  } = await createSellerStockLocationsWorkflow(container).run({
    input: {
      seller_id: sellerId,
      locations: [
        {
          name: locationName,
          address: {
            address_1: pickup.address_1,
            city: pickup.city,
            province: pickup.province,
            country_code: "ng",
            phone: config.phone,
          },
          metadata: addressMetadata,
        },
      ],
    },
  });

  await container.resolve(ContainerRegistrationKeys.LINK).create({
    [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: location.id, add: [salesChannelId] },
  });
  await createLocationFulfillmentSetWorkflow(container).run({
    input: {
      location_id: location.id,
      fulfillment_set_data: { name: `${config.name} delivery`, type: "shipping" },
    },
  });
  const {
    data: [locationWithSet],
  } = await query.graph({
    entity: "stock_location",
    fields: ["fulfillment_sets.id"],
    filters: { id: location.id },
  });
  const {
    result: [serviceZone],
  } = await createServiceZonesWorkflow(container).run({
    input: {
      data: [
        {
          fulfillment_set_id: locationWithSet.fulfillment_sets![0]!.id,
          name: `${config.name} Nigeria`,
          geo_zones: SEED_REGION.countries.map((country_code) => ({ country_code, type: "country" as const })),
        },
      ],
    },
  });
  await createSellerShippingOptionsWorkflow(container).run({
    input: {
      seller_id: sellerId,
      shipping_options: [
        {
          name: "Standard delivery",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfileId,
          type: { label: "Standard", description: "Delivered in 1-3 days.", code: "standard" },
          prices: [{ currency_code: SEED_REGION.currency_code, amount: SEED_DELIVERY_FEE }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    },
  });

  return { id: sellerId, config, ownerMemberId, stockLocationId: location.id };
}

type SeededProduct = { id: string; handle: string; variants: { id: string; sku: string }[] };

async function seedProducts(
  container: MedusaContainer,
  ctx: {
    createdBy: string;
    salesChannelId: string;
    categoryIds: Map<string, string>;
    sizeAttribute: SizeAttribute;
  }
): Promise<Map<string, SeededProduct>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const handles = SEED_PRODUCTS.map((p) => toHandle(p.title));
  const load = async () => {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "handle", "variants.id", "variants.sku"],
      filters: { handle: handles },
    });
    return new Map((data as SeededProduct[]).map((p) => [p.handle, p]));
  };

  const existing = await load();
  const missing = SEED_PRODUCTS.filter((p) => !existing.has(toHandle(p.title)));
  if (!missing.length) return existing;

  const products: CreateProductDTO[] = missing.map((item) => {
    const handle = toHandle(item.title);
    const sku = handle.toUpperCase();
    const image = seedImageUrl(item.title);
    return {
      title: item.title,
      handle,
      description: item.description,
      status: ProductStatus.PUBLISHED,
      category_ids: [ctx.categoryIds.get(item.category)!],
      sales_channels: [{ id: ctx.salesChannelId }],
      weight: item.weight_grams,
      thumbnail: image,
      images: [{ url: image }],
      attributes: item.sized
        ? [{ id: ctx.sizeAttribute.id, value_ids: ctx.sizeAttribute.values.map((v) => v.id) }]
        : [],
      variants: item.sized
        ? SEED_SIZES.map((size) => ({
            title: size,
            sku: `${sku}-${size}`,
            weight: item.weight_grams,
            options: { Size: size },
          }))
        : [{ title: item.title, sku, weight: item.weight_grams }],
    };
  });

  await createProductsWorkflow(container).run({
    input: { created_by: ctx.createdBy, products },
  });
  return load();
}

// Each shop offers every product in its department. The offer's price is the
// selling price; `compare_at_amount` (an Offer custom field) is the "was" price.
async function seedOffers(
  container: MedusaContainer,
  sellers: SeededSeller[],
  productsByHandle: Map<string, SeededProduct>,
  shippingProfileId: string
): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const wanted: (CreateOfferDTO & { compare_at?: number })[] = [];

  for (const seller of sellers) {
    const shopCode = toHandle(seller.config.name).toUpperCase();
    for (const item of SEED_PRODUCTS.filter((p) => p.department === seller.config.department)) {
      const product = productsByHandle.get(toHandle(item.title))!;
      for (const variant of product.variants) {
        const sku = `${shopCode}-${variant.sku}`;
        wanted.push({
          seller_id: seller.id,
          created_by: seller.ownerMemberId,
          sku,
          variant_id: variant.id,
          shipping_profile_id: shippingProfileId,
          inventory_items: [
            { sku, stock_levels: [{ location_id: seller.stockLocationId, stocked_quantity: 50 }] },
          ],
          prices: [{ amount: item.price, currency_code: SEED_REGION.currency_code }],
          compare_at: item.compare_at,
        });
      }
    }
  }

  const loadOffers = async () => {
    const { data } = await query.graph({
      entity: "offer",
      fields: ["id", "sku"],
      filters: { sku: wanted.map((o) => o.sku) },
    });
    return new Map((data as { id: string; sku: string }[]).map((o) => [o.sku, o.id]));
  };

  let offerIdBySku = await loadOffers();
  const missing = wanted.filter((o) => !offerIdBySku.has(o.sku));
  if (missing.length) {
    await createOffersWorkflow(container).run({
      input: { offers: missing.map(({ compare_at: _compareAt, ...offer }) => offer) },
    });
    offerIdBySku = await loadOffers();
  }

  const compareAt = wanted
    .filter((o) => o.compare_at != null)
    .map((o) => ({ id: offerIdBySku.get(o.sku)!, compare_at_amount: o.compare_at }));
  if (compareAt.length) {
    await container.resolve<any>(MercurModules.CUSTOM_FIELDS).upsert("offer", compareAt);
  }
  return wanted.length;
}
