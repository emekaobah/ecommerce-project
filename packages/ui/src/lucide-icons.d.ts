// lucide-react-native exports each icon at lucide-react-native/icons/<name> but ships no types
// for those paths. Each module's default export is the same LucideIcon its index exports.
declare module "lucide-react-native/icons/*" {
  import type { LucideIcon } from "lucide-react-native"
  const Icon: LucideIcon
  export default Icon
}
