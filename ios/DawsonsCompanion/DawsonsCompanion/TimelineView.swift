import SwiftUI

private let pixelsPerSecond: CGFloat = 90
private let laneHeight: CGFloat = 64

private func color(fromHex hex: UInt32) -> Color {
    Color(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255
    )
}

/// One instrument lane: pastel background, its clips laid out by time,
/// and a tap-anywhere gesture that opens the sound picker for that
/// exact step — the mobile equivalent of the browser's "touch anywhere
/// on the timeline of any instrument and the dropdown opens".
struct TrackLaneView: View {
    @ObservedObject var track: DAWTrack
    @Binding var selectedClipID: UUID?
    let totalWidth: CGFloat
    let onTapStep: (Int) -> Void
    let onDragClip: (UUID, Double) -> Void

    /// `DragGesture`'s `translation` is cumulative from the gesture's
    /// start, not incremental — so the drag target must be computed
    /// from the clip's position AT DRAG START, captured once here.
    /// Reading the clip's live `startSec` instead (which this same
    /// gesture is mutating via `onDragClip`) would feed each tick's
    /// output back in as the next tick's baseline, compounding into
    /// runaway drift far past the actual finger position.
    @State private var dragOriginSec: [UUID: Double] = [:]

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 14)
                .fill(color(fromHex: track.family.colorHex).opacity(0.35))
                .frame(width: totalWidth, height: laneHeight)
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        let step = Int((value.location.x / pixelsPerSecond) / Grid.stepSec)
                        onTapStep(max(0, step))
                    }
                )

            ForEach(track.clips) { clip in
                ClipView(
                    clip: clip,
                    color: color(fromHex: track.family.colorHex),
                    isSelected: selectedClipID == clip.id
                )
                .frame(width: max(6, CGFloat(clip.durationSec) * pixelsPerSecond), height: laneHeight - 12)
                .offset(x: CGFloat(clip.startSec) * pixelsPerSecond, y: 6)
                .onTapGesture { selectedClipID = clip.id }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            let origin = dragOriginSec[clip.id] ?? clip.startSec
                            if dragOriginSec[clip.id] == nil {
                                dragOriginSec[clip.id] = origin
                            }
                            let newStart = max(0, origin + Double(value.translation.width / pixelsPerSecond))
                            onDragClip(clip.id, newStart)
                        }
                        .onEnded { _ in
                            dragOriginSec[clip.id] = nil
                        }
                )
            }
        }
        .frame(width: totalWidth, height: laneHeight)
    }
}

private struct ClipView: View {
    let clip: Clip
    let color: Color
    let isSelected: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(color)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isSelected ? Color.white : Color.clear, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.15), radius: 2, y: 1)
    }
}

/// The full multi-track timeline: a header column of instrument names
/// (with mute/solo/pan) beside a horizontally-scrollable grid of lanes,
/// synced to a shared playhead — the desktop/browser mental model,
/// rebuilt as a native, touch-first control.
struct TimelineView: View {
    @ObservedObject var engine: DAWEngine
    @Binding var selectedClipID: UUID?
    @Binding var selectedTrackID: UUID?
    let onTapStep: (DAWTrack, Int) -> Void

    private var totalWidth: CGFloat {
        max(400, CGFloat(engine.totalDurationSec + 4) * pixelsPerSecond)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(engine.tracks) { track in
                    TrackHeaderView(track: track, isSelected: selectedTrackID == track.id)
                        .frame(height: laneHeight)
                        .onTapGesture { selectedTrackID = track.id }
                }
            }
            .frame(width: 108)
            .padding(.vertical, 4)

            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(engine.tracks) { track in
                        TrackLaneView(
                            track: track,
                            selectedClipID: $selectedClipID,
                            totalWidth: totalWidth,
                            onTapStep: { step in
                                selectedTrackID = track.id
                                onTapStep(track, step)
                            },
                            onDragClip: { id, newStart in
                                track.moveClip(id: id, toStartSec: newStart)
                            }
                        )
                    }

                    ZStack(alignment: .topLeading) {
                        Color.clear.frame(width: totalWidth, height: 1)
                        Rectangle()
                            .fill(Color.green)
                            .frame(width: 3)
                            .offset(x: CGFloat(engine.playheadSec) * pixelsPerSecond)
                    }
                    .frame(height: 1)
                }
                .padding(.vertical, 4)
            }
        }
    }
}

/// Compact per-track control strip: name, mute/solo, pan — the fixed
/// left column beside the scrolling lanes.
private struct TrackHeaderView: View {
    @ObservedObject var track: DAWTrack
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(track.name)
                .font(.caption).bold()
                .lineLimit(1)
            HStack(spacing: 6) {
                Button(track.muted ? "🔇" : "M") { track.muted.toggle() }
                    .font(.caption2)
                Button("S") { track.solo.toggle() }
                    .font(.caption2)
                    .foregroundStyle(track.solo ? .orange : .primary)
            }
            Slider(value: Binding(get: { Double(track.pan) }, set: { track.pan = Float($0) }), in: -1...1)
                .frame(height: 14)
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 10).fill(isSelected ? Color.accentColor.opacity(0.15) : Color.gray.opacity(0.08)))
    }
}
