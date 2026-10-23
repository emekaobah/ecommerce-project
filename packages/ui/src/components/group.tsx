import { Children, Fragment, isValidElement, type ReactNode } from "react"
import { View, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"

/**
 * The light rule between groups in a list: orders, shops in the cart, checkout and an order,
 * reviews. Use it as a list's `ItemSeparatorComponent`, or let `GroupList` place it.
 */
export function Divider({ style }: Readonly<{ style?: StyleProp<ViewStyle> }>) {
  const theme = useTheme()
  return <View style={[{ height: theme.line.divider, backgroundColor: theme.colors.divider }, style]} />
}

export type GroupProps = {
  children: ReactNode
  /** Space between what the group holds: `space[2]` or `space[3]`. */
  gap?: 2 | 3
  style?: StyleProp<ViewStyle>
}

/**
 * One group of a page, such as a shop's part of the cart or an order, or a saved address: flat on
 * the page, with no fill, outline or corners. Groups are told apart by the `Divider` between them
 * and the space around it (design: "Buyer-side groups … with no fill").
 */
export function Group({ children, gap = 3, style }: Readonly<GroupProps>) {
  const theme = useTheme()
  return <View style={[{ gap: theme.space[gap], paddingVertical: theme.space[4] }, style]}>{children}</View>
}

/** Groups one after another, with a `Divider` between each two and none after the last. */
export function GroupList({ children }: Readonly<{ children: ReactNode }>) {
  const groups = Children.toArray(children)
  return (
    <View>
      {groups.map((group, index) => (
        <Fragment key={isValidElement(group) && group.key !== null ? group.key : index}>
          {index > 0 ? <Divider /> : null}
          {group}
        </Fragment>
      ))}
    </View>
  )
}
