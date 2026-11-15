# S1 Editor

A phone-first video and photo editor that runs in the browser and installs like an app (PWA). It's styled after InShot's layout, with a cleaner interface and a background you can customize.

Open `editor/` on any HTTPS host (GitHub Pages works), then use **Add to Home screen** to install it.

## What it does

- **Video projects:** import clips and photos. You can trim, split, reorder, duplicate and delete them, change speed (0.1×–4×) or a photo's duration, and add transitions (fade, dip, flash, slide, zoom, wipe, spin).
- **Photo projects:** edit a single photo and save it as JPG or PNG at full resolution.
- **Look:** 14 filter presets with a strength slider, plus 11 adjustments (brightness, contrast, saturation, warmth, tint, highlights, shadows, sharpen, vignette, fade, grain). They're GPU-rendered (WebGL), so the preview stays live.
- **✨ Enhance:** reads the frame's histogram and sets exposure, contrast, color and sharpening automatically. You can apply it to one clip or every clip.
- **Canvas:** 9:16, 16:9, 1:1, 4:5, 3:4, 4:3 or original ratio, with fit or fill. The background behind the clip can be blurred, a solid color, a gradient or an image. You can also zoom, reposition, rotate and flip a clip, or add a Ken Burns-style move.
- **Text and stickers:** 8 fonts, colors, and outline, box, shadow or neon styles. Text can animate in (fade, pop, slide, typewriter, pulse). Drag it on the preview to move it; pinch to resize and rotate.
- **Sound:** import songs (or take the sound from any video) and set volume, fades, trim, placement and splits. You can record a voiceover while the video plays, and set each clip's volume or mute it.
- **Export:** 720p, 1080p or 2K at 24, 30 or 60 fps. The file is MP4 where the browser supports it, otherwise WebM. Exports are saved to the Library, and you can **Share** them through the phone's share sheet (Quick Share, Instagram, TikTok, Messages…) or **Save** them to the phone.
- **AI Portrait:** on-device person segmentation (MediaPipe). It can blur, dim, recolor or replace the background, or cut you out, live on video and in exports. A "Light on you" slider brightens just the person. Cut-out photos save as transparent PNGs.
- **AI Upscale & Restore:** the Swin2SR 4× model rebuilds detail and removes noise and JPEG blockiness on photos. It uses the GPU (WebGPU) when the phone has one.
- **Search (🔍 on every screen, Ctrl+K on desktop):** finds tools by what you mean ("slow motion" → Speed, "blur background" → AI), filters and transitions (tap to apply), music, files, projects and settings.
- **Search, pick, make a video:** search for a thing ("dog", "red car", "DJ") or a person plus a thing ("Me DJing"), tap results to pick them in order, then make a video or add them to the one you're editing. In videos, search finds the best moment ("at 1:24") and adds about 6 seconds around it.
- **AI search (opt-in):** MobileCLIP finds photos and videos by what's in them ("DJ playing music", "cowboy hat"). Face recognition (face-api) groups photos into people you can name and search. Scanning happens on the phone.
- **Export by destination:** choose YouTube, Shorts, Reels, an Instagram post or Story, TikTok, or custom. The app suggests the best shape, resolution (up to 4K), frame rate and bitrate, and warns about length limits.
- **Customizable toolbar:** drag tools into any order and hide the ones you don't use. Long-press a tool, or tap Customize.
- **Look:** themes, your own photo, a solid color or a custom gradient for the background. You can also set the accent color, text color, app font, and panel color and transparency, and save the result as your own theme.
- **✨ Create:** give it clips and photos and describe what you want, by typing or by voice. It returns 3 different short videos, or 3 cover images, that you can preview, edit or export. With a song, cuts land on the beat and the music starts at its most energetic part. It works on the phone, and with a Claude API key Claude looks at your footage and plans the edits.
- **Ask Claude (editor tool):** describe a change ("darker and moody", "add SATURDAY NIGHT at the start", "cut it to 15 seconds") and Claude edits the project. Every change can be undone. This needs your own Claude API key (Settings → Claude AI). The key is stored only on the device, and calls go straight to Anthropic using Claude Opus 5.5.
- **📌 References:** add a video or photo edit you like: a screen recording, a saved video, a screenshot, or a link shared from Instagram/YouTube/TikTok. The app finds every cut, the pacing, the music's BPM and how many cuts land on the beat, and the color look. **Make it for me** rebuilds the edit from your footage, with the same timing, each shot matched to your most similar moment, and the color matched. **Show me how** gives step-by-step directions with exact slider values and a shot list. With Claude connected, Claude also understands what each shot shows. Links can't be downloaded from those platforms, so the app asks for a screen recording.
- **Saving:** photos and videos ask where they're going and pick the right crop and size. Instagram, TikTok and Stories export at 1080p, since those apps convert uploads to 1080p anyway. YouTube gets up to 4K, YouTube thumbnails are capped under 2 MB, and print exports a full-size PNG. Results can be shared (Instagram, TikTok, Quick Share, Drive, Photos…), saved to the phone, and are always kept in the Library.
- **Library (file manager):** folders, filters by type, multi-select, share, save, move, rename and delete. Exports, voiceovers and saved frames are sorted into their own folders automatically.
- **Share into the app:** once it's installed, S1 Editor shows up in the Android share sheet, so you can share a video from your gallery straight into it.
- **Theme:** 8 background themes, your own photo (with a darkness slider) or a solid color, an accent color, and frosted or solid panels.

Everything is stored on the device in IndexedDB. Nothing is uploaded.

## Files

- `index.html`, `styles.css`: app shell
- `js/app.js`: screens, editor tools, library, settings
- `js/engine.js`: timeline playback, rendering, audio mixing, export
- `js/gl.js`: WebGL filters, adjustments, auto-enhance
- `js/media.js`: importing, thumbnails, save and share
- `js/ai.js`, `js/upscale-worker.js`: AI Portrait and AI Upscale
- `js/search.js`, `js/clip-worker.js`: search, AI content search and people
- `js/claude.js`: Claude API connection (official Anthropic SDK) and edit/plan schemas
- `js/db.js`: IndexedDB storage
- `sw.js`, `manifest.webmanifest`: offline support, install and share target

## Security & privacy

- **Local-first:** everything (media, projects, AI data, settings) stays in the browser's storage on the device. There are no accounts, no server and no tracking. If you publish the app, each person who installs it has their own private copy.
- **Claude:** each user brings their own Claude API key, stored only on their device, and requests go straight to Anthropic. The key is never put in exports or shared files.
- **Content Security Policy:** the page may only run code from itself and the pinned library CDN (jsDelivr), and may only contact the AI model hosts and the Anthropic API.
- **User text is never inserted as HTML:** file names, project names, notes, links and AI replies are always added as plain text. Links are limited to http(s).
- **AI output is checked before it's applied:** Claude returns JSON that must match a schema. Every value is clamped or limited to a fixed list before it touches a project, and every change can be undone.

## Publishing later

- Host `editor/` on any HTTPS host. GitHub Pages works.
- To list it in the Google Play Store, wrap it as a Trusted Web Activity with PWABuilder or Bubblewrap. That also needs a privacy policy stating the points above.
- Before a wide release, add an in-app note about Claude API costs, test on a few low-end phones (real-time 4K export needs a recent phone), and consider moving the CDN libraries into the app itself so everything works offline from first launch.

## Known limits

- Export runs in real time: a 60-second video takes about 60 seconds. Keep the screen on while it runs (the app asks the phone to stay awake).
- AI Upscale runs on photos only. Upscaling every video frame needs more power than a phone has. On phones without WebGPU it takes about 20 seconds per 128 px tile.
- AI models download the first time they're used: segmentation is 0.25–16 MB, upscaling about 53 MB, and AI search about 75 MB. After that they're cached for offline use.
- People recognition only looks at your own library. It never searches for people online.
- Music must come from files on your phone. The app doesn't download from YouTube or other streaming sites.
