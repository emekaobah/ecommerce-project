import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right"
import Bell from "lucide-react-native/icons/bell"
import Box from "lucide-react-native/icons/box"
import Camera from "lucide-react-native/icons/camera"
import Check from "lucide-react-native/icons/check"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Clock from "lucide-react-native/icons/clock"
import CloudOff from "lucide-react-native/icons/cloud-off"
import Handbag from "lucide-react-native/icons/handbag"
import Heart from "lucide-react-native/icons/heart"
import House from "lucide-react-native/icons/house"
import Info from "lucide-react-native/icons/info"
import ListFilter from "lucide-react-native/icons/list-filter"
import LocateFixed from "lucide-react-native/icons/locate-fixed"
import Lock from "lucide-react-native/icons/lock"
import LogOut from "lucide-react-native/icons/log-out"
import Mail from "lucide-react-native/icons/mail"
import MapPin from "lucide-react-native/icons/map-pin"
import Minus from "lucide-react-native/icons/minus"
import Pencil from "lucide-react-native/icons/pencil"
import Plus from "lucide-react-native/icons/plus"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import ScanBarcode from "lucide-react-native/icons/scan-barcode"
import Search from "lucide-react-native/icons/search"
import Share from "lucide-react-native/icons/share"
import ShieldCheck from "lucide-react-native/icons/shield-check"
import Star from "lucide-react-native/icons/star"
import Store from "lucide-react-native/icons/store"
import Tag from "lucide-react-native/icons/tag"
import TriangleAlert from "lucide-react-native/icons/triangle-alert"
import Truck from "lucide-react-native/icons/truck"
import User from "lucide-react-native/icons/user"
import X from "lucide-react-native/icons/x"
import Zap from "lucide-react-native/icons/zap"
import { useTheme } from "../theme"
import type { icon } from "../tokens"

// Imported one file each: the package's index would bundle all of Lucide.

/** The catalogue's drawn icon names and their Lucide matches (Foundations, Icons). */
const ICONS = {
  home: House,
  search: Search,
  bag: Handbag,
  box: Box,
  user: User,
  pin: MapPin,
  down: ChevronDown,
  back: ChevronLeft,
  fwd: ChevronRight,
  x: X,
  heart: Heart,
  share: Share,
  plus: Plus,
  minus: Minus,
  star: Star,
  truck: Truck,
  clock: Clock,
  shield: ShieldCheck,
  check: Check,
  scan: ScanBarcode,
  store: Store,
  bell: Bell,
  camera: Camera,
  tag: Tag,
  logout: LogOut,
  swap: ArrowLeftRight,
  mail: Mail,
  locate: LocateFixed,
  alert: TriangleAlert,
  refresh: RefreshCw,
  "cloud-off": CloudOff,
  info: Info,
  flash: Zap,
  lock: Lock,
  filter: ListFilter,
  edit: Pencil,
}

export type IconName = keyof typeof ICONS

/** Where the icon sits: each place has its size and stroke. */
export type IconUse = keyof typeof icon.size

export type IconProps = {
  name: IconName
  use?: IconUse
  /** A colour from the theme, usually ink, muted or onPrimary. Defaults to ink. */
  color?: string
  /** Filled states, such as a saved heart or a rating star, fill with the same colour. */
  filled?: boolean
  /**
   * Spoken when the icon carries meaning of its own; otherwise the icon is hidden from screen
   * readers. An icon-only button carries its label on the button instead.
   */
  label?: string
}

export function Icon({ name, use = "default", color, filled, label }: Readonly<IconProps>) {
  const theme = useTheme()
  const Glyph = ICONS[name]
  const colour = color ?? theme.colors.ink
  return (
    <Glyph
      size={theme.icon.size[use]}
      strokeWidth={theme.icon.stroke[use]}
      color={colour}
      fill={filled ? colour : "none"}
      accessible={Boolean(label)}
      accessibilityLabel={label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
    />
  )
}
