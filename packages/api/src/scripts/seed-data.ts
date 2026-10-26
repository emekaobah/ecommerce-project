// Oja's demo world: three Lagos shops and a small shared catalogue. Brands and
// people are invented. Amounts are NGN in major units (₦14,500 = 14500), weights
// in grams. Every seeded account uses SEED_PASSWORD (documented in the README).

import type { ReviewStatus, WeeklyHours } from "@oja/domain"
import type { ShippingDefaults } from "../lib/shipping-defaults"

export const SEED_PASSWORD = "supersecret"

export const SEED_REGION = { name: "Nigeria", currency_code: "ngn", countries: ["ng"] }

/** Where the region counts its days (ADR 0004), kept in the region's `metadata.time_zone`. */
export const SEED_REGION_TIME_ZONE = "Africa/Lagos"

/** Nigerian VAT, charged on the region's tax-inclusive prices. */
export const SEED_VAT = { name: "VAT", code: "VAT", rate: 7.5 }

export const SEED_SALES_CHANNEL = "Oja Buyer App"

export type Department = "Groceries" | "Fashion" | "Electronics"

type SeedPerson = { email: string; first_name: string; last_name: string }

export type SeedSeller = {
  name: string
  department: Department
  description: string
  phone: string
  /** Pickup address in the NG form's columns (ADR 0002): LGA in `city`, state in `province`. */
  pickup: {
    address_1: string
    city: string
    province: string
    landmark: string
    latitude: number
    longitude: number
  }
  /**
   * Where the shop is paid (#26) where Paystack isn't configured: a Paystack bank code and an
   * invented 10-digit NUBAN. With Paystack, shops are paid into `seedBankAccount()` instead.
   */
  bank: { bank_code: string; bank_name: string; account_number: string }
  /** Weekly opening hours in the region's timezone (ADR 0004): a gate to going live. */
  hours: WeeklyHours
  /** Where buyers collect in store, at the pickup address (#12); a shop without one only delivers. */
  collection_point?: { instructions: string }
  owner: SeedPerson
  staff: SeedPerson
}

/**
 * The one account every seeded shop is paid into where Paystack is configured. Paystack checks
 * account numbers with the bank even in test mode, so it must be a real account; a test key
 * moves no money. Kept in `SEED_BANK_CODE` and `SEED_BANK_ACCOUNT_NUMBER`, never in the repo.
 */
export function seedBankAccount(
  env: Record<string, string | undefined> = process.env
): { bank_code: string; account_number: string } | undefined {
  const { SEED_BANK_CODE: bank_code, SEED_BANK_ACCOUNT_NUMBER: account_number } = env
  return bank_code && account_number ? { bank_code, account_number } : undefined
}

const daily =(opens: string, closes: string) => [{ opens, closes }]

export const SEED_SELLERS: SeedSeller[] = [
  {
    name: "Iya Bisi Foodstuff",
    department: "Groceries",
    description: "Rice, beans, garri and soup ingredients from Surulere.",
    phone: "+2348031234501",
    pickup: {
      address_1: "14 Adeniran Ogunsanya Street",
      city: "Surulere",
      province: "Lagos",
      landmark: "Beside the filling station, near the roundabout",
      latitude: 6.4953,
      longitude: 3.3548,
    },
    bank: { bank_code: "058", bank_name: "Guaranty Trust Bank", account_number: "0123456781" },
    // A neighbourhood foodstuff shop: early till late, Sunday afternoons after church.
    hours: {
      mon: daily("07:00", "20:00"),
      tue: daily("07:00", "20:00"),
      wed: daily("07:00", "20:00"),
      thu: daily("07:00", "20:00"),
      fri: daily("07:00", "20:00"),
      sat: daily("07:00", "20:00"),
      sun: daily("13:00", "18:00"),
    },
    owner: { email: "grocery.owner@oja.test", first_name: "Bisi", last_name: "Adeyemi" },
    staff: { email: "grocery.staff@oja.test", first_name: "Kunle", last_name: "Adeyemi" },
  },
  {
    name: "Adire House",
    department: "Fashion",
    description: "Hand-dyed adire and Ankara pieces, made in Lekki.",
    phone: "+2348031234502",
    pickup: {
      address_1: "22 Admiralty Way, Lekki Phase 1",
      city: "Eti-Osa",
      province: "Lagos",
      landmark: "Second floor, above the pharmacy",
      latitude: 6.4478,
      longitude: 3.4723,
    },
    bank: { bank_code: "058", bank_name: "Guaranty Trust Bank", account_number: "0123456782" },
    // A boutique: late mornings, closed Sundays.
    hours: {
      mon: daily("10:00", "19:00"),
      tue: daily("10:00", "19:00"),
      wed: daily("10:00", "19:00"),
      thu: daily("10:00", "19:00"),
      fri: daily("10:00", "19:00"),
      sat: daily("10:00", "17:00"),
      sun: [],
    },
    // Buyers can try on before collecting: the demo's pickup shop.
    collection_point: { instructions: "Come up to the second floor and give your code at the counter." },
    owner: { email: "fashion.owner@oja.test", first_name: "Ngozi", last_name: "Okafor" },
    staff: { email: "fashion.staff@oja.test", first_name: "Chidi", last_name: "Eze" },
  },
  {
    name: "Ikeja Gadget Hub",
    department: "Electronics",
    description: "Chargers, power banks and home power from Computer Village.",
    phone: "+2348031234503",
    pickup: {
      address_1: "5 Otigba Street, Computer Village",
      city: "Ikeja",
      province: "Lagos",
      landmark: "Blue gate opposite the bank",
      latitude: 6.5965,
      longitude: 3.3421,
    },
    bank: { bank_code: "058", bank_name: "Guaranty Trust Bank", account_number: "0123456783" },
    // Computer Village hours, with a break for Friday prayers.
    hours: {
      mon: daily("09:00", "18:00"),
      tue: daily("09:00", "18:00"),
      wed: daily("09:00", "18:00"),
      thu: daily("09:00", "18:00"),
      fri: [
        { opens: "09:00", closes: "12:30" },
        { opens: "14:30", closes: "18:00" },
      ],
      sat: daily("10:00", "16:00"),
      sun: [],
    },
    owner: { email: "electronics.owner@oja.test", first_name: "Emeka", last_name: "Nwosu" },
    staff: { email: "electronics.staff@oja.test", first_name: "Musa", last_name: "Bello" },
  },
]

/** Departments (roots) and their sub-categories; array order sets `rank`. */
export const SEED_CATEGORIES: Record<Department, string[]> = {
  Groceries: ["Rice & Grains", "Beans & Garri", "Oils & Spices", "Snacks & Drinks", "Fresh Produce", "Chilled & Frozen"],
  Fashion: ["Men's Clothing", "Women's Clothing", "Bags & Accessories"],
  Electronics: ["Phone Accessories", "Power & Lighting", "Audio"],
}

/** Fresh and chilled groceries: perishable, so delivered only by the end of the next day (#69). */
export const SEED_PERISHABLE_CATEGORIES = ["Fresh Produce", "Chilled & Frozen"]

export const SEED_SIZES = ["S", "M", "L", "XL"]

/**
 * Starter category attributes (Mercur product attributes linked to a department
 * and each of its sub-categories). Required ones gate publishing.
 */
export type SeedAttribute = {
  name: string
  handle: string
  type: "single_select" | "text"
  is_required: boolean
  values?: string[]
}

export const SEED_CATEGORY_ATTRIBUTES: Record<Department, SeedAttribute[]> = {
  Groceries: [
    { name: "Storage", handle: "storage", type: "single_select", is_required: true, values: ["Cool, dry place", "Refrigerate", "Freeze"] },
    { name: "Shelf life", handle: "shelf-life", type: "text", is_required: false },
  ],
  Fashion: [
    {
      name: "Fabric",
      handle: "fabric",
      type: "single_select",
      is_required: true,
      values: ["Cotton", "Adire cotton", "Ankara wax print", "Aso oke", "Linen", "Canvas", "Leather"],
    },
    { name: "Care instructions", handle: "care-instructions", type: "text", is_required: false },
  ],
  Electronics: [
    { name: "Voltage", handle: "voltage", type: "single_select", is_required: true, values: ["5V USB", "12V DC", "220-240V AC"] },
    { name: "Warranty", handle: "warranty", type: "single_select", is_required: false, values: ["No warranty", "3 months", "6 months", "12 months"] },
  ],
}

/**
 * Shipping defaults a product takes from its category when it is created without
 * its own (see src/lib/shipping-defaults.ts).
 */
const DEPARTMENT_SHIPPING: Record<Department, ShippingDefaults> = {
  Groceries: { weight: 1000, length: 30, width: 20, height: 15, package_category: "groceries" },
  Fashion: { weight: 400, length: 35, width: 25, height: 5, package_category: "fashion" },
  Electronics: { weight: 500, length: 20, width: 15, height: 10, package_category: "electronics" },
}

const SUBCATEGORY_SHIPPING: Record<string, Partial<ShippingDefaults>> = {
  "Rice & Grains": { weight: 5000, length: 50, width: 35, height: 12 },
  "Beans & Garri": { weight: 2000, length: 35, width: 25, height: 10 },
  "Snacks & Drinks": { weight: 300, length: 25, width: 18, height: 10 },
  "Fresh Produce": { weight: 1000, length: 30, width: 20, height: 12 },
  "Chilled & Frozen": { weight: 1200, length: 30, width: 20, height: 12 },
  "Bags & Accessories": { weight: 350, length: 40, width: 35, height: 8 },
  "Power & Lighting": { weight: 1500, length: 35, width: 30, height: 25 },
  Audio: { weight: 200, length: 12, width: 10, height: 6 },
}

/** Shipping defaults for a department, or for one of its sub-categories. */
export const seedShippingDefaults = (department: Department, category: string = department): ShippingDefaults => ({
  ...DEPARTMENT_SHIPPING[department],
  ...SUBCATEGORY_SHIPPING[category],
})

export type SeedProduct = {
  title: string
  department: Department
  category: string
  description: string
  /**
   * How many demo photos it has in demo-images/products: `<handle>.webp` (the thumbnail), then
   * `<handle>-2.webp` and on, in gallery order (see demo-images.ts).
   */
  photos: number
  /** Price in NGN at the department's shop. */
  price: number
  /**
   * Other shops that also sell it, at their own price. Shows the same product
   * under two shops in search and category results (never side by side).
   */
  also_at?: { shop: string; price: number }[]
  weight_grams: number
  /** One variant per size (S–XL) instead of a single variant. */
  sized?: boolean
  /**
   * The single variant's EAN-13, for scanning while picking. In-store codes (GS1 prefix 200),
   * so they never clash with a real product's barcode.
   */
  barcode?: string
  /** Starter attribute values by attribute handle (select values by name). */
  attributes: Record<string, string>
}

export const SEED_PRODUCTS: SeedProduct[] = [
  // Groceries
  { title: "Ofada Rice 5kg", photos: 3, barcode: "2000000000015", department: "Groceries", category: "Rice & Grains", price: 14500, weight_grams: 5000, description: "Stone-free local ofada rice, bagged in Abeokuta.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Long Grain Parboiled Rice 10kg", photos: 1, barcode: "2000000000022", department: "Groceries", category: "Rice & Grains", price: 22000, weight_grams: 10000, description: "Everyday parboiled rice for jollof and fried rice.", attributes: { storage: "Cool, dry place", "shelf-life": "18 months" } },
  { title: "Honey Beans (Oloyin) 2kg", photos: 3, barcode: "2000000000039", department: "Groceries", category: "Beans & Garri", price: 6800, weight_grams: 2000, description: "Sweet brown beans, handpicked and cleaned.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Ijebu Garri 4kg", photos: 3, barcode: "2000000000046", department: "Groceries", category: "Beans & Garri", price: 5200, weight_grams: 4000, description: "Crisp, sour white garri for soaking or eba.", attributes: { storage: "Cool, dry place", "shelf-life": "6 months" } },
  { title: "Red Palm Oil 3L", photos: 1, barcode: "2000000000053", department: "Groceries", category: "Oils & Spices", price: 9500, weight_grams: 2800, description: "Unbleached red palm oil in a sealed jerrycan.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Ground Crayfish 500g", photos: 1, barcode: "2000000000060", department: "Groceries", category: "Oils & Spices", price: 4500, weight_grams: 500, description: "Finely ground dried crayfish for soups and stews.", attributes: { storage: "Refrigerate", "shelf-life": "3 months once opened" } },
  { title: "Dried Zobo Leaves 250g", photos: 1, barcode: "2000000000077", department: "Groceries", category: "Snacks & Drinks", price: 1800, weight_grams: 250, description: "Dried hibiscus petals for homemade zobo.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Plantain Chips 150g", photos: 3, barcode: "2000000000084", department: "Groceries", category: "Snacks & Drinks", price: 1200, also_at: [{ shop: "Ikeja Gadget Hub", price: 1300 }], weight_grams: 150, description: "Thin-sliced, lightly salted ripe plantain chips.", attributes: { storage: "Cool, dry place", "shelf-life": "3 months" } },
  { title: "Fresh Tomatoes 1kg", photos: 3, barcode: "2000000000176", department: "Groceries", category: "Fresh Produce", price: 3500, weight_grams: 1000, description: "Firm, ripe Jos tomatoes for stew, picked this week.", attributes: { storage: "Refrigerate", "shelf-life": "5 days" } },
  { title: "Frozen Whole Chicken 1.2kg", photos: 1, barcode: "2000000000183", department: "Groceries", category: "Chilled & Frozen", price: 9800, weight_grams: 1200, description: "Cleaned whole chicken, kept frozen until it leaves the shop.", attributes: { storage: "Freeze", "shelf-life": "3 months frozen" } },
  // Fashion
  { title: "Adire Kaftan", photos: 4, department: "Fashion", category: "Men's Clothing", price: 28000, weight_grams: 450, sized: true, description: "Indigo hand-dyed adire kaftan in soft cotton.", attributes: { fabric: "Adire cotton", "care-instructions": "Hand wash cold; dry in the shade" } },
  { title: "Ankara Wrap Dress", photos: 4, department: "Fashion", category: "Women's Clothing", price: 32000, weight_grams: 400, sized: true, description: "Midi wrap dress in a bold Ankara print.", attributes: { fabric: "Ankara wax print", "care-instructions": "Machine wash cold; iron inside out" } },
  { title: "Aso Oke Fila Cap", photos: 4, barcode: "2000000000091", department: "Fashion", category: "Bags & Accessories", price: 8500, weight_grams: 150, description: "Handwoven aso oke cap for owambe days.", attributes: { fabric: "Aso oke", "care-instructions": "Spot clean only" } },
  { title: "Ankara Tote Bag", photos: 4, barcode: "2000000000107", department: "Fashion", category: "Bags & Accessories", price: 12000, weight_grams: 350, description: "Lined canvas tote with an Ankara print panel.", attributes: { fabric: "Canvas", "care-instructions": "Spot clean only" } },
  // Electronics
  { title: "20,000mAh Power Bank", photos: 3, barcode: "2000000000114", department: "Electronics", category: "Power & Lighting", price: 24000, weight_grams: 420, description: "Charges a phone four times over; USB-C in and out.", attributes: { voltage: "5V USB", warranty: "6 months" } },
  { title: "Rechargeable LED Lantern", photos: 3, barcode: "2000000000121", department: "Electronics", category: "Power & Lighting", price: 9800, also_at: [{ shop: "Iya Bisi Foodstuff", price: 10500 }], weight_grams: 600, description: "Up to 12 hours of light for NEPA outages.", attributes: { voltage: "5V USB", warranty: "3 months" } },
  { title: "Rechargeable Standing Fan 16-inch", photos: 3, barcode: "2000000000138", department: "Electronics", category: "Power & Lighting", price: 65000, weight_grams: 5500, description: "Runs up to 8 hours on its built-in battery.", attributes: { voltage: "220-240V AC", warranty: "12 months" } },
  { title: "6-Way Surge Protector", photos: 3, barcode: "2000000000145", department: "Electronics", category: "Phone Accessories", price: 11500, weight_grams: 900, description: "Surge-protected extension with two USB ports.", attributes: { voltage: "220-240V AC", warranty: "6 months" } },
  { title: "25W USB-C Fast Charger", photos: 1, barcode: "2000000000152", department: "Electronics", category: "Phone Accessories", price: 7500, also_at: [{ shop: "Iya Bisi Foodstuff", price: 7900 }], weight_grams: 120, description: "Wall charger with a 1m USB-C cable.", attributes: { voltage: "220-240V AC", warranty: "6 months" } },
  { title: "Wireless Earbuds", photos: 3, barcode: "2000000000169", department: "Electronics", category: "Audio", price: 18500, weight_grams: 80, description: "Bluetooth 5.3 earbuds with a charging case.", attributes: { voltage: "5V USB", warranty: "3 months" } },
]

/**
 * Demo buyers' reviews of the seeded shops and products (#7), each written on an order the buyer
 * received, as the API requires. Reviewers are invented customers; `DEMO_BUYER_EMAIL` is the
 * simulator's signed-in buyer, whose orders are added only once they have signed in (see
 * demo-reviews.ts). Every shop and product on an order is reviewed by its buyer, on that order
 * or an earlier one, so none of the demo orders waits to be reviewed.
 */
export type SeedReview = {
  rating: 1 | 2 | 3 | 4 | 5
  /** The buyer's words; a rating alone has none. */
  text?: string
  status: ReviewStatus
  /** The shop's reply, shown under a published review. */
  reply?: string
}

export type SeedReviewer = SeedPerson & {
  /** Where their orders went: a Lagos street, and its LGA in `city` (ADR 0002). */
  address: { address_1: string; city: string }
}

/** The buyer the iOS simulator is signed in as (Clerk): My reviews shows their reviews. */
export const DEMO_BUYER_EMAIL = "maestro-buyer+clerk_test@example.com"

/** How the demo buyer is named on their orders, as Clerk gives them no name. */
export const DEMO_BUYER: SeedReviewer = {
  email: DEMO_BUYER_EMAIL,
  first_name: "Maestro",
  last_name: "Buyer",
  address: { address_1: "9 Ozumba Mbadiwe Avenue, Victoria Island", city: "Eti-Osa" },
}

export const SEED_REVIEWERS: SeedReviewer[] = [
  { email: "tunde.bakare@oja.test", first_name: "Tunde", last_name: "Bakare", address: { address_1: "12 Bode Thomas Street", city: "Surulere" } },
  { email: "amaka.okonkwo@oja.test", first_name: "Amaka", last_name: "Okonkwo", address: { address_1: "8 Herbert Macaulay Way, Yaba", city: "Lagos Mainland" } },
  { email: "funmi.alabi@oja.test", first_name: "Funmi", last_name: "Alabi", address: { address_1: "3 Fola Osibo Road, Lekki Phase 1", city: "Eti-Osa" } },
  { email: "ibrahim.sani@oja.test", first_name: "Ibrahim", last_name: "Sani", address: { address_1: "21 Allen Avenue", city: "Ikeja" } },
  { email: "kemi.oladipo@oja.test", first_name: "Kemi", last_name: "Oladipo", address: { address_1: "5 Ogunlana Drive", city: "Surulere" } },
  { email: "obinna.chukwu@oja.test", first_name: "Obinna", last_name: "Chukwu", address: { address_1: "14 Awolowo Road, Ikoyi", city: "Eti-Osa" } },
]

export type SeedReviewedOrder = {
  /** The buyer's email: a reviewer's, or `DEMO_BUYER_EMAIL`. */
  buyer: string
  shop: string
  /** Delivered by courier, or collected in store (only where the shop has a collection point). */
  method: "delivery" | "pickup"
  /** How many days ago the buyer received it; their reviews are from that day. */
  days_ago: number
  /** The buyer's review of the shop, unless they reviewed it on an earlier order. */
  shop_review?: SeedReview
  /** What they bought, each at the shop's price, and their review of it (unless written earlier). */
  lines: { product: string; size?: string; quantity?: number; review?: SeedReview }[]
}

const [GROCERY, FASHION, GADGETS] = SEED_SELLERS.map((s) => s.name)

/** Oldest first, as each buyer received them. */
export const SEED_REVIEWED_ORDERS: SeedReviewedOrder[] = [
  {
    buyer: "tunde.bakare@oja.test",
    shop: GROCERY,
    method: "delivery",
    days_ago: 34,
    shop_review: {
      rating: 5,
      text: "Everything came complete and the rider called before he reached.",
      status: "published",
      reply: "Thank you Tunde! We're always here when you need foodstuff.",
    },
    lines: [
      { product: "Ofada Rice 5kg", review: { rating: 5, text: "Proper ofada, stone-free like they said. The aroma filled my kitchen.", status: "published" } },
      { product: "Red Palm Oil 3L", review: { rating: 4, text: "Original palm oil, not mixed. The jerrycan was a bit oily outside sha.", status: "published" } },
    ],
  },
  {
    buyer: "funmi.alabi@oja.test",
    shop: FASHION,
    method: "pickup",
    days_ago: 29,
    shop_review: {
      rating: 5,
      text: "Tried it on at the shop before collecting and the fit was perfect. Very patient staff.",
      status: "published",
      reply: "Thank you Funmi, wear it well! New prints land next week.",
    },
    lines: [
      { product: "Ankara Wrap Dress", size: "M", review: { rating: 5, text: "The colours didn't run after the first wash. I'm ordering another print.", status: "published" } },
    ],
  },
  {
    buyer: DEMO_BUYER_EMAIL,
    shop: GROCERY,
    method: "delivery",
    days_ago: 26,
    shop_review: {
      rating: 5,
      text: "My go-to for foodstuff now. Prices are fair.",
      status: "published",
      reply: "Thank you for always buying from us!",
    },
    lines: [
      { product: "Ijebu Garri 4kg", review: { rating: 5, text: "Sharp and crisp, perfect for soaking.", status: "published" } },
      { product: "Plantain Chips 150g", quantity: 3, review: { rating: 4, status: "published" } },
    ],
  },
  {
    buyer: "tunde.bakare@oja.test",
    shop: GADGETS,
    method: "delivery",
    days_ago: 23,
    shop_review: {
      rating: 5,
      text: "Original product and fast delivery from Computer Village.",
      status: "published",
      reply: "We only sell original. Thanks for buying, Tunde!",
    },
    lines: [
      { product: "20,000mAh Power Bank", review: { rating: 5, text: "Charges my phone four times, true true. Not a fake one.", status: "published" } },
    ],
  },
  {
    buyer: "amaka.okonkwo@oja.test",
    shop: GROCERY,
    method: "delivery",
    days_ago: 20,
    shop_review: { rating: 4, text: "Good shop. Delivery took a bit long but everything was fresh.", status: "published" },
    lines: [
      { product: "Honey Beans (Oloyin) 2kg", review: { rating: 5, status: "published" } },
      { product: "Ground Crayfish 500g", review: { rating: 4, text: "Clean crayfish, no sand at all.", status: "published" } },
    ],
  },
  {
    buyer: DEMO_BUYER_EMAIL,
    shop: FASHION,
    method: "pickup",
    days_ago: 17,
    shop_review: { rating: 4, text: "Lovely shop, but parking around Admiralty Way is hard.", status: "published" },
    lines: [
      // Contact details aren't allowed in a review.
      { product: "Adire Kaftan", size: "L", review: { rating: 3, text: "Size L runs small. Call me on 08012345678 if you want to buy mine.", status: "rejected" } },
    ],
  },
  {
    buyer: "ibrahim.sani@oja.test",
    shop: GADGETS,
    method: "delivery",
    days_ago: 16,
    shop_review: {
      rating: 3,
      text: "The fan is fine but they took long to reply my message.",
      status: "published",
      reply: "Sorry for the delay, Ibrahim. We now answer messages within the hour.",
    },
    lines: [
      {
        product: "Rechargeable Standing Fan 16-inch",
        review: { rating: 4, text: "Lasts about 6 hours on a full charge, not 8. Still a lifesaver when there's no light.", status: "published" },
      },
    ],
  },
  {
    buyer: "kemi.oladipo@oja.test",
    shop: FASHION,
    method: "delivery",
    days_ago: 13,
    shop_review: { rating: 4, text: "Beautiful pieces. Took three days to reach Surulere, but worth it.", status: "published" },
    lines: [
      { product: "Aso Oke Fila Cap", review: { rating: 4, status: "published" } },
      { product: "Ankara Tote Bag", review: { rating: 5, text: "Strong and roomy. My laptop fits inside.", status: "published" } },
    ],
  },
  {
    buyer: "obinna.chukwu@oja.test",
    shop: GADGETS,
    method: "delivery",
    days_ago: 11,
    // Abuse isn't allowed in a review.
    shop_review: { rating: 1, text: "These people are thieves!!! Don't try them.", status: "rejected" },
    lines: [{ product: "Plantain Chips 150g", quantity: 2, review: { rating: 4, text: "Crunchy and not too salty.", status: "published" } }],
  },
  {
    buyer: "ibrahim.sani@oja.test",
    shop: GROCERY,
    method: "delivery",
    days_ago: 9,
    shop_review: {
      rating: 2,
      text: "Tomatoes came squashed. Customer care was polite about it, though.",
      status: "published",
      reply: "Sorry about that, Ibrahim. We now pack fresh produce in crates.",
    },
    lines: [{ product: "Fresh Tomatoes 1kg", quantity: 2, review: { rating: 2, text: "Half of them were too soft by the time they arrived.", status: "published" } }],
  },
  {
    buyer: "amaka.okonkwo@oja.test",
    shop: GADGETS,
    method: "delivery",
    days_ago: 7,
    shop_review: { rating: 4, text: "Good prices and the charger is original.", status: "published" },
    lines: [
      { product: "Wireless Earbuds", review: { rating: 3, text: "Sound is clear but the bass is weak. The case charges fast.", status: "published" } },
      { product: "25W USB-C Fast Charger", review: { rating: 5, status: "published" } },
    ],
  },
  {
    buyer: "obinna.chukwu@oja.test",
    shop: FASHION,
    method: "pickup",
    days_ago: 5,
    shop_review: { rating: 5, status: "published" },
    lines: [
      { product: "Adire Kaftan", size: "M", review: { rating: 5, text: "Wore it to my cousin's wedding and everybody asked where I got it.", status: "published" } },
    ],
  },
  {
    buyer: DEMO_BUYER_EMAIL,
    shop: GADGETS,
    method: "delivery",
    days_ago: 4,
    shop_review: { rating: 5, text: "Quick delivery and everything was well packed.", status: "pending" },
    lines: [{ product: "6-Way Surge Protector", review: { rating: 4, text: "Working well with my fridge and TV so far.", status: "pending" } }],
  },
  {
    buyer: "kemi.oladipo@oja.test",
    shop: GADGETS,
    method: "delivery",
    days_ago: 3,
    shop_review: { rating: 5, text: "Fast delivery to Surulere.", status: "pending" },
    lines: [{ product: "Rechargeable LED Lantern", review: { rating: 5, text: "Bright light, and it lasts the whole night.", status: "pending" } }],
  },
  {
    buyer: "obinna.chukwu@oja.test",
    shop: GROCERY,
    method: "delivery",
    days_ago: 2,
    shop_review: { rating: 4, text: "Rice is good. The rider came late, past 9pm, but he called first.", status: "published" },
    lines: [{ product: "Long Grain Parboiled Rice 10kg", review: { rating: 4, status: "published" } }],
  },
  {
    buyer: DEMO_BUYER_EMAIL,
    shop: GROCERY,
    method: "delivery",
    days_ago: 1,
    // The shop was reviewed on the first order from it.
    lines: [{ product: "Frozen Whole Chicken 1.2kg", review: { rating: 2, text: "The chicken was already thawing when it arrived.", status: "pending" } }],
  },
]
