// Oja's demo world: three Lagos shops and a small shared catalogue. Brands and
// people are invented. Amounts are NGN in major units (₦14,500 = 14500), weights
// in grams. Every seeded account uses SEED_PASSWORD (documented in the README).

export const SEED_PASSWORD = "supersecret"

export const SEED_REGION = { name: "Nigeria", currency_code: "ngn", countries: ["ng"] }

/** Nigerian VAT, charged on the region's tax-inclusive prices. */
export const SEED_VAT = { name: "VAT", code: "VAT", rate: 7.5 }

export const SEED_SALES_CHANNEL = "Oja Buyer App"

/** Flat delivery fee per shop until Shipbubble quotes replace it. */
export const SEED_DELIVERY_FEE = 2500

type Department = "Groceries" | "Fashion" | "Electronics"

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

export type SeedProduct = {
  title: string
  department: Department
  category: string
  description: string
  /** Selling price in NGN. */
  price: number
  /** Crossed-out "was" price; always above `price`. */
  compare_at?: number
  weight_grams: number
  /** One variant per size (S–XL) instead of a single variant. */
  sized?: boolean
}

export const SEED_PRODUCTS: SeedProduct[] = [
  // Groceries
  { title: "Ofada Rice 5kg", department: "Groceries", category: "Rice & Grains", price: 14500, compare_at: 16000, weight_grams: 5000, description: "Stone-free local ofada rice, bagged in Abeokuta." },
  { title: "Long Grain Parboiled Rice 10kg", department: "Groceries", category: "Rice & Grains", price: 22000, weight_grams: 10000, description: "Everyday parboiled rice for jollof and fried rice." },
  { title: "Honey Beans (Oloyin) 2kg", department: "Groceries", category: "Beans & Garri", price: 6800, weight_grams: 2000, description: "Sweet brown beans, handpicked and cleaned." },
  { title: "Ijebu Garri 4kg", department: "Groceries", category: "Beans & Garri", price: 5200, compare_at: 6000, weight_grams: 4000, description: "Crisp, sour white garri for soaking or eba." },
  { title: "Red Palm Oil 3L", department: "Groceries", category: "Oils & Spices", price: 9500, weight_grams: 2800, description: "Unbleached red palm oil in a sealed jerrycan." },
  { title: "Ground Crayfish 500g", department: "Groceries", category: "Oils & Spices", price: 4500, weight_grams: 500, description: "Finely ground dried crayfish for soups and stews." },
  { title: "Dried Zobo Leaves 250g", department: "Groceries", category: "Snacks & Drinks", price: 1800, weight_grams: 250, description: "Dried hibiscus petals for homemade zobo." },
  { title: "Plantain Chips 150g", department: "Groceries", category: "Snacks & Drinks", price: 1200, compare_at: 1500, weight_grams: 150, description: "Thin-sliced, lightly salted ripe plantain chips." },
  // Fashion
  { title: "Adire Kaftan", department: "Fashion", category: "Men's Clothing", price: 28000, compare_at: 35000, weight_grams: 450, sized: true, description: "Indigo hand-dyed adire kaftan in soft cotton." },
  { title: "Ankara Wrap Dress", department: "Fashion", category: "Women's Clothing", price: 32000, weight_grams: 400, sized: true, description: "Midi wrap dress in a bold Ankara print." },
  { title: "Aso Oke Fila Cap", department: "Fashion", category: "Bags & Accessories", price: 8500, weight_grams: 150, description: "Handwoven aso oke cap for owambe days." },
  { title: "Ankara Tote Bag", department: "Fashion", category: "Bags & Accessories", price: 12000, compare_at: 15000, weight_grams: 350, description: "Lined canvas tote with an Ankara print panel." },
  // Electronics
  { title: "20,000mAh Power Bank", department: "Electronics", category: "Power & Lighting", price: 24000, compare_at: 29500, weight_grams: 420, description: "Charges a phone four times over; USB-C in and out." },
  { title: "Rechargeable LED Lantern", department: "Electronics", category: "Power & Lighting", price: 9800, weight_grams: 600, description: "Up to 12 hours of light for NEPA outages." },
  { title: "Rechargeable Standing Fan 16-inch", department: "Electronics", category: "Power & Lighting", price: 65000, compare_at: 72000, weight_grams: 5500, description: "Runs up to 8 hours on its built-in battery." },
  { title: "6-Way Surge Protector", department: "Electronics", category: "Phone Accessories", price: 11500, weight_grams: 900, description: "Surge-protected extension with two USB ports." },
  { title: "25W USB-C Fast Charger", department: "Electronics", category: "Phone Accessories", price: 7500, compare_at: 9000, weight_grams: 120, description: "Wall charger with a 1m USB-C cable." },
  { title: "Wireless Earbuds", department: "Electronics", category: "Audio", price: 18500, weight_grams: 80, description: "Bluetooth 5.3 earbuds with a charging case." },
]

/**
 * Placeholder pack shot: the product name on the app's light-grey tile. Stands in
 * until the catalogue pipeline stores real photos in R2.
 */
export const seedImageUrl = (title: string) =>
  `https://placehold.co/800x800/F3F3F3/000000/png?text=${encodeURIComponent(title).replace(/%20/g, "+")}`
