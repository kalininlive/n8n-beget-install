# GENESIS MONTAGE v2 — local reference assets

This folder contains the HyperFrames component library copied from `video-production-test-agy/hyperframes/components` (236 component blocks, HTML and registry metadata). These are reusable source assets; the montage runner does not evaluate every block automatically. Generated scenes use the installed HyperFrames runtime and local GSAP; no CDN is required for the renderer's current slide templates.

Font assets in `../fonts/` are the merged Cyrillic + Latin reference fonts from `video-production-test-agy/public/fonts`: Unbounded 900/800 and Inter 400/700/800. OFL notices are included alongside them. ASS captions and generated HyperFrames slides both use these local fonts.

Component IDs and original licensing/metadata: each component folder's `registry-item.json` and source HTML. Review any block's external references before authoring it into a production scene.
