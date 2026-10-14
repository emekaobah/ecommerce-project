import { Module } from "@medusajs/framework/utils"
import CollectionPointModuleService from "./service"

export const COLLECTION_POINT_MODULE = "collectionPoint"
export { CollectionPointModuleService }

export default Module(COLLECTION_POINT_MODULE, {
  service: CollectionPointModuleService,
})
