const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")

MetadataStorage.clear()

// The account the seed pays its shops into where Paystack is configured: in tests, the fake
// Paystack (helpers/paystack.ts), which resolves any 10-digit account at its banks.
process.env.SEED_BANK_CODE = "058"
process.env.SEED_BANK_ACCOUNT_NUMBER = "0123456789"
