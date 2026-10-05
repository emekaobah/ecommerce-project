import { photoExtension } from "../quick-add"

describe("photoExtension", () => {
  it("stores JPEG, PNG and WebP photos under their extension", () => {
    expect(["image/jpeg", "image/png", "image/webp"].map(photoExtension)).toEqual(["jpg", "png", "webp"])
  })

  it("refuses any other type, including names every object has", () => {
    expect(["image/gif", "application/pdf", "constructor", "toString"].map(photoExtension)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})
