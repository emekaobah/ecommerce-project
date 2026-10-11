import { seedBankAccount } from "../scripts/seed-data"

// Paystack checks account numbers with the bank even in test mode, so the seed pays every shop
// into one real account from the environment rather than an invented one.
describe("seedBankAccount", () => {
  it("reads the account the seeded shops are paid into", () => {
    expect(seedBankAccount({ SEED_BANK_CODE: "058", SEED_BANK_ACCOUNT_NUMBER: "0123456789" })).toEqual({
      bank_code: "058",
      account_number: "0123456789",
    })
  })

  it("is unset until both the bank and the account number are", () => {
    expect(seedBankAccount({})).toBeUndefined()
    expect(seedBankAccount({ SEED_BANK_CODE: "058" })).toBeUndefined()
    expect(seedBankAccount({ SEED_BANK_ACCOUNT_NUMBER: "0123456789" })).toBeUndefined()
    expect(seedBankAccount({ SEED_BANK_CODE: "", SEED_BANK_ACCOUNT_NUMBER: "" })).toBeUndefined()
  })
})
