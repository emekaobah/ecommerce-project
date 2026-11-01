package expo.modules.ojaliveupdate

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `LiveUpdateView` in @oja/domain, which says what each field means. */
class LiveUpdateRecord : Record {
  @Field var id: String = ""
  @Field var revision: Double = 0.0
  @Field var url: String = ""
  @Field var title: String = ""
  @Field var text: String = ""
  @Field var subText: String? = null
  @Field var chip: String? = null
  @Field var icon: String = "bag"
  @Field var ongoing: Boolean = true
  @Field var timeoutMs: Double = 0.0
  @Field var color: ThemedColorRecord = ThemedColorRecord()
  @Field var progress: ProgressRecord? = null
  @Field var olderBar: OlderBarRecord? = null
  @Field var countdownTo: Double? = null
}

class ThemedColorRecord : Record {
  @Field var light: String = "#000000"
  @Field var dark: String = "#FFFFFF"
}

class ProgressRecord : Record {
  @Field var segments: List<SegmentRecord> = emptyList()
  @Field var points: List<Int> = emptyList()
  @Field var position: Int = 0
  @Field var tracker: String? = null
  @Field var styledByProgress: Boolean = true
}

class SegmentRecord : Record {
  @Field var length: Int = 1
  @Field var color: ThemedColorRecord? = null
}

class OlderBarRecord : Record {
  @Field var max: Int = 0
  @Field var current: Int = 0
}
