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
  confirmProductsWorkflow,
  createProductsWorkflow,
  updateProductAttributesWorkflow,
  createSellerAccountWorkflow,
  createSellerMembersStep,
  createSellerShippingOptionsWorkflow,
  updateSellerAddressWorkflow,
  createSellerStockLocationsWorkflow,
  upsertMembersStep,
  updateCommissionRatesWorkflow,
} from "@mercurjs/core/workflows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createLinksWorkflow,
  dismissLinksWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductCategoriesWorkflow,
  updateProductCategoriesWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingProfilesWorkflow,
  deleteShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  setAuthAppMetadataStep,
  updateSalesChannelsWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  SEED_CATEGORIES,
  SEED_CATEGORY_ATTRIBUTES,
  SEED_PASSWORD,
  SEED_PERISHABLE_CATEGORIES,
  SEED_PRODUCTS,
  SEED_REGION,
  SEED_REGION_TIME_ZONE,
  SEED_SALES_CHANNEL,
  SEED_SELLERS,
  SEED_SIZES,
  SEED_VAT,
  seedBankAccount,
  seedImageUrl,
  seedShippingDefaults,
  type Department,
  type SeedSeller,
} from "./seed-data";
import { PAYSTACK_PROVIDER_ID, paystackClient } from "../modules/paystack";
import { SHIPBUBBLE_PROVIDER_ID } from "../modules/shipbubble";
import { setCategoryPerishable } from "../lib/perishable";
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../modules/shop-bank-account";
import { ADDRESS_CODE, addressCodeOf, validatedPickupChange } from "../lib/delivery";
import { COMMISSION_PERCENT } from "../lib/payouts";
import { saveBankAccount } from "../lib/onboarding";
import { sellersWithHours, setWeeklyHours } from "../lib/shop-hours";
import { saveShopBankAccountWorkflow } from "../workflows/onboarding/save-shop-bank-account";
import { errorMessage } from "../lib/errors";

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
        // Offers are priced per currency, not per region, and Medusa applies a region's
        // tax-inclusive preference only to region-scoped prices: the currency must say it too.
        supported_currencies: [{ currency_code: SEED_REGION.currency_code, is_default: true, is_tax_inclusive: true }],
        default_sales_channel_id: salesChannelId,
      },
    },
  });
  await seedPublishableKey(container, salesChannelId);

  logger.info("Seeding the Nigeria region and VAT...");
  await seedRegion(container);

  logger.info("Setting the commission...");
  await seedCommission(container);

  logger.info("Seeding categories and attributes...");
  const categoryIds = await seedCategories(container);
  await Promise.all(SEED_PERISHABLE_CATEGORIES.map((name) => setCategoryPerishable(container, categoryIds.get(name)!, true)));
  const sizeAttribute = await seedSizeAttribute(container);
  const categoryAttributes = await seedCategoryAttributes(container, categoryIds);

  const shippingProfileId = await seedShippingProfile(container);

  const sellers: SeededSeller[] = [];
  // One shop at a time: each creates its members, stock location and Shipbubble option, and
  // the log reads in order.
  for (const config of SEED_SELLERS) {
    logger.info(`Seeding seller "${config.name}"...`);
    sellers.push(await seedSeller(container, config, salesChannelId, shippingProfileId));
  }

  logger.info("Completing the sellers' onboarding...");
  // One shop at a time, like the sellers above: run together, Mercur's seller-address and
  // bank-account workflows race and a shop can be left not live.
  for (const seller of sellers) await seedOnboarding(container, seller);

  logger.info("Seeding products...");
  const productsByHandle = await seedProducts(container, {
    createdBy: sellers[0].ownerMemberId,
    salesChannelId,
    categoryIds,
    sizeAttribute,
    categoryAttributes,
  });

  logger.info("Seeding offers...");
  const offerCount = await seedOffers(container, sellers, productsByHandle, shippingProfileId);

  logger.info("Publishing products...");
  await publishSeedProducts(container, [...productsByHandle.values()].map((p) => p.id));

  const { data: regions } = await query.graph({ entity: "region", fields: ["id"] });
  logger.info(
    `Finished seeding: ${regions.length} region, ${sellers.length} sellers, ${productsByHandle.size} products, ${offerCount} offers.`
  );
}

/**
 * Oja's flat commission (#29) as Mercur's global rate, so the vendor panel shows it on each
 * order: of each line as the buyer paid it, tax included, and never of delivery, as payouts
 * work it out (`payoutOf`). Mercur seeds the rate at 0%.
 */
async function seedCommission(container: MedusaContainer) {
  const { data } = await container
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "commission_rate", fields: ["id"], filters: { is_default: true } });
  if (!data[0]) throw new Error("Mercur has no global commission rate to set");
  await updateCommissionRatesWorkflow(container).run({
    input: [{ id: data[0].id, value: COMMISSION_PERCENT, include_tax: true, include_shipping: false }],
  });
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
  // Buyers pay with Paystack only. Medusa's system provider takes no money, so it is offered
  // only while Paystack isn't configured (PAYSTACK_SECRET_KEY), to let checkout be tried.
  const [paystack] = await container
    .resolve(Modules.PAYMENT)
    .listPaymentProviders({ id: PAYSTACK_PROVIDER_ID, is_enabled: true });
  const payment_providers = paystack ? [PAYSTACK_PROVIDER_ID] : ["pp_system_default"];
  if (!existing) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            ...SEED_REGION,
            metadata: { time_zone: SEED_REGION_TIME_ZONE },
            payment_providers,
            automatic_taxes: true,
            // Nigerian shelf prices include VAT.
            is_tax_inclusive: true,
          },
        ],
      },
    });
  } else {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: existing.id },
        update: { payment_providers, metadata: { ...existing.metadata, time_zone: SEED_REGION_TIME_ZONE } },
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

  const departmentOf = (name: string) =>
    parents.find((parent) => parent === name || SEED_CATEGORIES[parent].includes(name))!;
  const metadataFor = (name: string) => ({ shipping_defaults: seedShippingDefaults(departmentOf(name), name) });

  const create = async (inputs: { name: string; rank: number; parent_category_id?: string }[]) => {
    if (!inputs.length) return;
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: inputs.map((c) => ({ ...c, is_active: true, metadata: metadataFor(c.name) })),
      },
    });
    result.forEach((c) => idByName.set(c.name, c.id));
  };

  // Categories seeded before shipping defaults existed get them now.
  await Promise.all(
    existing
      .filter((c) => !c.metadata?.shipping_defaults)
      .map((category) =>
        updateProductCategoriesWorkflow(container).run({
          input: {
            selector: { id: category.id },
            update: { metadata: { ...category.metadata, ...metadataFor(category.name) } },
          },
        })
      )
  );

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

type CategoryAttribute = {
  id: string;
  handle: string;
  type: string;
  is_required: boolean;
  values: { id: string; name: string }[];
  categories?: ({ id: string } | null)[] | null;
};

// Each department's starter attributes, linked to the department and every one
// of its sub-categories so they surface on the product form for all of them.
// Attributes that already exist are brought back in line with the seed data:
// their required flag and category links.
async function seedCategoryAttributes(
  container: MedusaContainer,
  categoryIds: Map<string, string>
): Promise<Map<string, CategoryAttribute>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const departments = Object.keys(SEED_CATEGORY_ATTRIBUTES) as Department[];
  const handles = departments.flatMap((d) => SEED_CATEGORY_ATTRIBUTES[d].map((a) => a.handle));
  const load = async () => {
    const { data } = await query.graph({
      entity: "product_attribute",
      fields: ["id", "handle", "type", "is_required", "values.id", "values.name", "categories.id"],
      filters: { handle: handles, product_id: null } as any,
    });
    return new Map((data as CategoryAttribute[]).map((a) => [a.handle, a]));
  };

  const categoryIdsFor = (department: Department) =>
    [department, ...SEED_CATEGORIES[department]].map((name) => categoryIds.get(name)!);

  const existing = await load();
  await syncCategoryAttributes(container, existing, categoryIdsFor);
  const missing = departments.flatMap((department) =>
    SEED_CATEGORY_ATTRIBUTES[department]
      .filter((a) => !existing.has(a.handle))
      .map((a) => ({
        name: a.name,
        handle: a.handle,
        type: a.type === "text" ? AttributeType.TEXT : AttributeType.SINGLE_SELECT,
        is_required: a.is_required,
        is_filterable: a.type !== "text",
        rank: SEED_CATEGORY_ATTRIBUTES[department].indexOf(a) + 1,
        values: (a.values ?? []).map((name, rank) => ({ name, rank })),
        category_ids: categoryIdsFor(department),
      }))
  );
  if (!missing.length) return existing;
  await createProductAttributesWorkflow(container).run({ input: { attributes: missing } });
  return load();
}

async function syncCategoryAttributes(
  container: MedusaContainer,
  existing: Map<string, CategoryAttribute>,
  categoryIdsFor: (department: Department) => string[]
) {
  const pair = (attributeId: string, categoryId: string) => ({
    [MercurModules.PRODUCT_ATTRIBUTE]: { product_attribute_id: attributeId },
    [Modules.PRODUCT]: { product_category_id: categoryId },
  });
  const toLink: ReturnType<typeof pair>[] = [];
  const toUnlink: ReturnType<typeof pair>[] = [];
  const toRequire: { id: string; is_required: boolean }[] = [];

  for (const department of Object.keys(SEED_CATEGORY_ATTRIBUTES) as Department[]) {
    const wanted = new Set(categoryIdsFor(department));
    for (const seedAttribute of SEED_CATEGORY_ATTRIBUTES[department]) {
      const attribute = existing.get(seedAttribute.handle);
      if (!attribute) continue;
      if (attribute.is_required !== seedAttribute.is_required) {
        toRequire.push({ id: attribute.id, is_required: seedAttribute.is_required });
      }
      const linked = new Set((attribute.categories ?? []).flatMap((c) => (c?.id ? [c.id] : [])));
      wanted.forEach((id) => !linked.has(id) && toLink.push(pair(attribute.id, id)));
      linked.forEach((id) => !wanted.has(id) && toUnlink.push(pair(attribute.id, id)));
    }
  }
  await Promise.all(
    toRequire.map(({ id, is_required }) =>
      updateProductAttributesWorkflow(container).run({ input: { selector: { id }, update: { is_required } } })
    )
  );
  if (toUnlink.length) await dismissLinksWorkflow(container).run({ input: toUnlink });
  if (toLink.length) await createLinksWorkflow(container).run({ input: toLink });
}

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
  const pickupAddress = {
    address_1: pickup.address_1,
    city: pickup.city,
    province: pickup.province,
    country_code: SEED_REGION.countries[0],
    phone: config.phone,
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
        // Coordinates stay on the seller's address only; staff never see them (ADR 0002).
        address: {
          ...pickupAddress,
          first_name: config.owner.first_name,
          last_name: config.owner.last_name,
          company: config.name,
          metadata: {
            landmark: pickup.landmark,
            latitude: pickup.latitude,
            longitude: pickup.longitude,
          },
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
    await seedShipbubbleDelivery(container, sellerId, config, existingLocation.id, shippingProfileId);
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
          address: pickupAddress,
          metadata: { landmark: pickup.landmark },
        },
      ],
    },
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
  await createServiceZonesWorkflow(container).run({
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
  await seedShipbubbleDelivery(container, sellerId, config, location.id, shippingProfileId);

  return { id: sellerId, config, ownerMemberId, stockLocationId: location.id };
}

// Each shop delivers with Shipbubble (#23): one calculated shipping option whose price is the
// courier rate the buyer picks at checkout. Replaces the flat delivery earlier seeds created.
async function seedShipbubbleDelivery(
  container: MedusaContainer,
  sellerId: string,
  config: SeedSeller,
  locationId: string,
  shippingProfileId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [location],
  } = await query.graph({
    entity: "stock_location",
    fields: [
      "fulfillment_providers.id",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.provider_id",
    ],
    filters: { id: locationId },
  });
  if (!location.fulfillment_providers?.some((p: { id: string } | null) => p?.id === SHIPBUBBLE_PROVIDER_ID)) {
    await container.resolve(ContainerRegistrationKeys.LINK).create({
      [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: SHIPBUBBLE_PROVIDER_ID },
    });
  }
  const serviceZone = location.fulfillment_sets![0]!.service_zones![0]!;
  const options = (serviceZone.shipping_options ?? []) as { id: string; provider_id: string }[];
  const flat = options.filter((o) => o.provider_id !== SHIPBUBBLE_PROVIDER_ID).map((o) => o.id);
  if (flat.length) await deleteShippingOptionsWorkflow(container).run({ input: { ids: flat } });
  if (options.some((o) => o.provider_id === SHIPBUBBLE_PROVIDER_ID)) return;

  await createSellerShippingOptionsWorkflow(container).run({
    input: {
      seller_id: sellerId,
      shipping_options: [
        {
          name: `${config.name} delivery`,
          price_type: "calculated",
          provider_id: SHIPBUBBLE_PROVIDER_ID,
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfileId,
          data: { id: "shipbubble" },
          type: { label: "Delivery", description: "Courier rates from Shipbubble.", code: "shipbubble" },
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    },
  });
}

// The address code and Paystack recipient a shop gets where the seed can't ask Shipbubble or
// Paystack (integration tests without their fakes). Such an environment can't deliver or pay
// anyway; these only let its shops be live so the catalogue shows.
const UNVALIDATED_ADDRESS_CODE = 0;
const UNVERIFIED_RECIPIENT = "RCP_seed_unverified";

// Each shop goes live the way a shop owner makes it (#26): its weekly hours set (ADR 0004), its
// pickup address validated with Shipbubble (by the seeded pin) and the seed's bank account
// (`seedBankAccount()`) resolved with Paystack. A shop without one is left for its owner to finish
// in the vendor panel.
async function seedOnboarding(container: MedusaContainer, seller: SeededSeller) {
  // Hours a shop has changed since are its own.
  if (!(await sellersWithHours(container, [seller.id])).has(seller.id)) {
    await setWeeklyHours(container, seller.id, seller.config.hours);
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [row],
  } = await query.graph({ entity: "seller", fields: ["id", "currency_code", "address.id", "address.metadata"], filters: { id: seller.id } });

  // A placeholder from a seed run without Shipbubble is replaced once Shipbubble is configured.
  const code = addressCodeOf(row.address);
  const shipbubble = !!process.env.SHIPBUBBLE_API_KEY;
  if (code == null || (shipbubble && code === UNVALIDATED_ADDRESS_CODE)) {
    const { metadata } = shipbubble
      ? await validatedPickupChange(container, seller.id, {})
      : { metadata: { ...row.address!.metadata, [ADDRESS_CODE]: UNVALIDATED_ADDRESS_CODE } };
    await updateSellerAddressWorkflow(container).run({ input: { seller_id: seller.id, data: { metadata } } });
  }

  const [account] = await container
    .resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
    .listShopBankAccounts({ seller_id: seller.id });
  const { bank } = seller.config;
  if (!paystackClient()) {
    if (account) return;
    await saveShopBankAccountWorkflow(container).run({
      input: {
        seller_id: seller.id,
        currency_code: row.currency_code,
        bank_code: bank.bank_code,
        bank_name: bank.bank_name,
        account_number: bank.account_number,
        account_name: `${seller.config.owner.first_name} ${seller.config.owner.last_name}`.toUpperCase(),
        recipient_code: UNVERIFIED_RECIPIENT,
      },
    });
    return;
  }
  // As above: a placeholder recipient is replaced once Paystack is configured.
  if (account && account.recipient_code !== UNVERIFIED_RECIPIENT) return;
  const payTo = seedBankAccount();
  if (!payTo) {
    logger.warn(
      `"${seller.config.name}" isn't live: set SEED_BANK_CODE and SEED_BANK_ACCOUNT_NUMBER to a real account for Paystack to resolve, or its owner can add one in the vendor panel.`
    );
    return;
  }
  try {
    await saveBankAccount(container, seller.id, payTo);
  } catch (error) {
    logger.warn(
      `"${seller.config.name}" isn't live: Paystack didn't take its bank account (${errorMessage(error)}). Its owner can add one in the vendor panel.`
    );
  }
}

type SeededProduct = { id: string; handle: string; variants: { id: string; sku: string }[] };

async function seedProducts(
  container: MedusaContainer,
  ctx: {
    createdBy: string;
    salesChannelId: string;
    categoryIds: Map<string, string>;
    sizeAttribute: SizeAttribute;
    categoryAttributes: Map<string, CategoryAttribute>;
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
      // Proposed until the shops have listed it, then approved (see publishSeedProducts).
      status: ProductStatus.PROPOSED,
      category_ids: [ctx.categoryIds.get(item.category)!],
      sales_channels: [{ id: ctx.salesChannelId }],
      weight: item.weight_grams,
      thumbnail: image,
      images: [{ url: image }],
      attributes: [
        ...(item.sized
          ? [{ id: ctx.sizeAttribute.id, value_ids: ctx.sizeAttribute.values.map((v) => v.id) }]
          : []),
        ...Object.entries(item.attributes).map(([handle, value]) => {
          const attribute = ctx.categoryAttributes.get(handle)!;
          if (attribute.type === AttributeType.TEXT) return { id: attribute.id, value };
          return { id: attribute.id, value_ids: [attribute.values.find((v) => v.name === value)!.id] };
        }),
      ],
      variants: item.sized
        ? SEED_SIZES.map((size) => ({
            title: size,
            sku: `${sku}-${size}`,
            weight: item.weight_grams,
            options: { Size: size },
          }))
        : [{ title: item.title, sku, weight: item.weight_grams, ...(item.barcode && { barcode: item.barcode, ean: item.barcode }) }],
    };
  });

  await createProductsWorkflow(container).run({
    input: { created_by: ctx.createdBy, products },
  });
  return load();
}

// Each shop offers every product in its department, plus the products that list
// it in `also_at`, each at that shop's own price.
async function seedOffers(
  container: MedusaContainer,
  sellers: SeededSeller[],
  productsByHandle: Map<string, SeededProduct>,
  shippingProfileId: string
): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const wanted: CreateOfferDTO[] = [];

  for (const seller of sellers) {
    const shopCode = toHandle(seller.config.name).toUpperCase();
    const range = SEED_PRODUCTS.flatMap((item) => {
      if (item.department === seller.config.department) return [{ item, price: item.price }];
      const extra = item.also_at?.find((a) => a.shop === seller.config.name);
      return extra ? [{ item, price: extra.price }] : [];
    });
    for (const { item, price } of range) {
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
          prices: [{ amount: price, currency_code: SEED_REGION.currency_code }],
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
      input: { offers: missing },
    });
    offerIdBySku = await loadOffers();
  }

  return wanted.length;
}

// The seeded catalogue is approved once every product is sellable, through the
// same publish gate as any other product. No operator exists in the seed, so the
// approval is recorded without an actor.
async function publishSeedProducts(container: MedusaContainer, productIds: string[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: productIds, status: ProductStatus.PROPOSED },
  });
  if (!data.length) return;
  await confirmProductsWorkflow(container).run({
    input: { product_ids: data.map((p: { id: string }) => p.id) },
  });
}
