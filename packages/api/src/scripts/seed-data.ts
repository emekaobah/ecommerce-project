// Oja's demo world: three Lagos shops and a small shared catalogue. Brands and
// people are invented. Amounts are NGN in major units (₦14,500 = 14500), weights
// in grams. Every seeded account uses SEED_PASSWORD (documented in the README).

import type { ShippingDefaults } from "../lib/shipping-defaults"

export const SEED_PASSWORD = "supersecret"

export const SEED_REGION = { name: "Nigeria", currency_code: "ngn", countries: ["ng"] }

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
   * Where the shop is paid (#26): a Paystack bank code and a 10-digit NUBAN. Invented numbers at
   * GTBank, which Paystack's test mode resolves to a dummy holder; live keys need real accounts.
   */
  bank: { bank_code: string; bank_name: string; account_number: string }
  owner: SeedPerson
  staff: SeedPerson
}

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
    owner: { email: "electronics.owner@oja.test", first_name: "Emeka", last_name: "Nwosu" },
    staff: { email: "electronics.staff@oja.test", first_name: "Musa", last_name: "Bello" },
  },
]

/** Departments (roots) and their sub-categories; array order sets `rank`. */
export const SEED_CATEGORIES: Record<Department, string[]> = {
  Groceries: ["Rice & Grains", "Beans & Garri", "Oils & Spices", "Snacks & Drinks"],
  Fashion: ["Men's Clothing", "Women's Clothing", "Bags & Accessories"],
  Electronics: ["Phone Accessories", "Power & Lighting", "Audio"],
}

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
  { title: "Ofada Rice 5kg", barcode: "2000000000015", department: "Groceries", category: "Rice & Grains", price: 14500, weight_grams: 5000, description: "Stone-free local ofada rice, bagged in Abeokuta.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Long Grain Parboiled Rice 10kg", barcode: "2000000000022", department: "Groceries", category: "Rice & Grains", price: 22000, weight_grams: 10000, description: "Everyday parboiled rice for jollof and fried rice.", attributes: { storage: "Cool, dry place", "shelf-life": "18 months" } },
  { title: "Honey Beans (Oloyin) 2kg", barcode: "2000000000039", department: "Groceries", category: "Beans & Garri", price: 6800, weight_grams: 2000, description: "Sweet brown beans, handpicked and cleaned.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Ijebu Garri 4kg", barcode: "2000000000046", department: "Groceries", category: "Beans & Garri", price: 5200, weight_grams: 4000, description: "Crisp, sour white garri for soaking or eba.", attributes: { storage: "Cool, dry place", "shelf-life": "6 months" } },
  { title: "Red Palm Oil 3L", barcode: "2000000000053", department: "Groceries", category: "Oils & Spices", price: 9500, weight_grams: 2800, description: "Unbleached red palm oil in a sealed jerrycan.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Ground Crayfish 500g", barcode: "2000000000060", department: "Groceries", category: "Oils & Spices", price: 4500, weight_grams: 500, description: "Finely ground dried crayfish for soups and stews.", attributes: { storage: "Refrigerate", "shelf-life": "3 months once opened" } },
  { title: "Dried Zobo Leaves 250g", barcode: "2000000000077", department: "Groceries", category: "Snacks & Drinks", price: 1800, weight_grams: 250, description: "Dried hibiscus petals for homemade zobo.", attributes: { storage: "Cool, dry place", "shelf-life": "12 months" } },
  { title: "Plantain Chips 150g", barcode: "2000000000084", department: "Groceries", category: "Snacks & Drinks", price: 1200, also_at: [{ shop: "Ikeja Gadget Hub", price: 1300 }], weight_grams: 150, description: "Thin-sliced, lightly salted ripe plantain chips.", attributes: { storage: "Cool, dry place", "shelf-life": "3 months" } },
  // Fashion
  { title: "Adire Kaftan", department: "Fashion", category: "Men's Clothing", price: 28000, weight_grams: 450, sized: true, description: "Indigo hand-dyed adire kaftan in soft cotton.", attributes: { fabric: "Adire cotton", "care-instructions": "Hand wash cold; dry in the shade" } },
  { title: "Ankara Wrap Dress", department: "Fashion", category: "Women's Clothing", price: 32000, weight_grams: 400, sized: true, description: "Midi wrap dress in a bold Ankara print.", attributes: { fabric: "Ankara wax print", "care-instructions": "Machine wash cold; iron inside out" } },
  { title: "Aso Oke Fila Cap", barcode: "2000000000091", department: "Fashion", category: "Bags & Accessories", price: 8500, weight_grams: 150, description: "Handwoven aso oke cap for owambe days.", attributes: { fabric: "Aso oke", "care-instructions": "Spot clean only" } },
  { title: "Ankara Tote Bag", barcode: "2000000000107", department: "Fashion", category: "Bags & Accessories", price: 12000, weight_grams: 350, description: "Lined canvas tote with an Ankara print panel.", attributes: { fabric: "Canvas", "care-instructions": "Spot clean only" } },
  // Electronics
  { title: "20,000mAh Power Bank", barcode: "2000000000114", department: "Electronics", category: "Power & Lighting", price: 24000, weight_grams: 420, description: "Charges a phone four times over; USB-C in and out.", attributes: { voltage: "5V USB", warranty: "6 months" } },
  { title: "Rechargeable LED Lantern", barcode: "2000000000121", department: "Electronics", category: "Power & Lighting", price: 9800, also_at: [{ shop: "Iya Bisi Foodstuff", price: 10500 }], weight_grams: 600, description: "Up to 12 hours of light for NEPA outages.", attributes: { voltage: "5V USB", warranty: "3 months" } },
  { title: "Rechargeable Standing Fan 16-inch", barcode: "2000000000138", department: "Electronics", category: "Power & Lighting", price: 65000, weight_grams: 5500, description: "Runs up to 8 hours on its built-in battery.", attributes: { voltage: "220-240V AC", warranty: "12 months" } },
  { title: "6-Way Surge Protector", barcode: "2000000000145", department: "Electronics", category: "Phone Accessories", price: 11500, weight_grams: 900, description: "Surge-protected extension with two USB ports.", attributes: { voltage: "220-240V AC", warranty: "6 months" } },
  { title: "25W USB-C Fast Charger", barcode: "2000000000152", department: "Electronics", category: "Phone Accessories", price: 7500, also_at: [{ shop: "Iya Bisi Foodstuff", price: 7900 }], weight_grams: 120, description: "Wall charger with a 1m USB-C cable.", attributes: { voltage: "220-240V AC", warranty: "6 months" } },
  { title: "Wireless Earbuds", barcode: "2000000000169", department: "Electronics", category: "Audio", price: 18500, weight_grams: 80, description: "Bluetooth 5.3 earbuds with a charging case.", attributes: { voltage: "5V USB", warranty: "3 months" } },
]

/**
 * Placeholder pack shot: the product name on the app's light-grey tile. Stands in
 * until the catalogue pipeline stores real photos in R2.
 */
export const seedImageUrl = (title: string) =>
  `https://placehold.co/800x800/F3F3F3/000000/png?text=${encodeURIComponent(title).replace(/%20/g, "+")}`
