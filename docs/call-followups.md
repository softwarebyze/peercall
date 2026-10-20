# Follow-ups from the first group call

The merge candidate fixes capture cleanup, repeated screen-share camera acquisition,
focus transitions that remounted video/audio, cropped camera display, screenshot
stretching, and device/copy/input polish. It adds per-participant audio activity and
an invitation-specific social image. It does not change the preview deployment.

## Next feature work

- **Camera and screen at the same time:** feasible. Publish separate video tracks
  with explicit camera/screen identity, negotiate senders safely, and keep camera
  audio playback independent of screen tiles. Update late joins, recording,
  screenshots, layout, and teardown together. Do not simply add another track to
  the current peer-to-single-stream map: it can overwrite the camera stream.
- **Organizer identity across reconnects:** today the first socket gets host
  controls, and a disconnect transfers them to the next participant. A transient
  signaling reconnect can therefore explain Jeff becoming host. The exact event
  in the meeting is not established from the report. Use a server-issued resume
  credential and a short reconnect grace period; never grant privileges based on
  display name or `?host=1`. Keep explicit Leave and temporary network loss distinct.
- **Elapsed call time:** send a room start timestamp from signaling and render a
  shared elapsed clock, rather than separate per-client timers that disagree.
- **Home preview:** now explicitly labelled as a preview. A genuinely interactive
  demo can be considered separately.

## Browser follow-through

Scott's exact camera failure needs a real-device reproduction. The merge candidate
adds useful busy/permission guidance, a lobby camera retry, and in-place retry for
an existing camera that disconnects, without replacing the working microphone.
Audio-only and listen-only peers reserve send/receive media slots, so a device can be enabled in the existing call without renegotiating or replacing the working mic. No browser restart is required by those recovery paths. This does not establish
that every OS/browser camera fault can be recovered in-app.

- Record browser/OS, error name, live/ended track state and actual capture settings
  when reproducing; keep this diagnostic detail out of normal user-facing copy.
- [MDN constraints guidance](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints):
  inspect capabilities, prefer `ideal` resolution/frame-rate constraints, and use
  `getSettings()` for actual results. Reserve `exact` for an explicitly selected
  device and offer recovery if it disappears. `applyConstraints()` can tune an
  existing live track; it does not repair an ended track or release leaked tracks.
- [MDN getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities):
  broad current-browser support dates from October 2024; feature-detect older
  browsers. This is not a new API invented in 2026.
- [MDN contentHint](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/contentHint):
  screen shares now request `detail` where supported. It is a hint, not a quality
  guarantee; camera-plus-screen bandwidth tuning remains follow-up work.
- [MDN stop](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop):
  stop every owned capture track, including hidden camera tracks and results that
  arrive after teardown; remove tracks from video elements on unmount.
- [React portals](https://react.dev/reference/react-dom/createPortal): changing a
  portal target recreates its content. The focus fix keeps videos under one stable
  parent and changes only grid placement, preserving playback identity.
- [Vercel interface guidelines](https://vercel.com/design/guidelines): mobile inputs
  use at least 16px font sizes, and browser zoom stays enabled. This addresses the
  common iOS input-focus zoom trigger; a viewport-size test is not a physical
  Safari-device test.

## Acceptance checks

Before the next group call, test Safari/macOS and mobile Safari on real devices:
permission denial then recovery, camera busy in another app, camera unplug/replug,
background/foreground, browser Stop sharing, repeated shares, focus/unfocus during
remote speech, Leave and End for everyone. Confirm capture indicators go out after
leaving when no other tab/app owns the camera. Test multi-peer active-speaker
indicators without duplicate audio playback.
