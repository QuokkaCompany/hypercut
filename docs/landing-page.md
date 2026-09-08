# Interactive landing page

The English marketing page is independent of the editor. Run `npm run build:landing` and `npm run preview:landing`, then open `http://127.0.0.1:4174/`. The normal `npm run build` also includes `/landing.html` alongside the existing editor entry point. The editor's root route is unchanged.

`site-dist/` is a standalone static-site output, with its own `index.html`, bundled fonts, JavaScript and media. Serve it at a domain root using a static host with byte-range support for the walkthrough video. No backend or environment keys are needed. Production hosting is provided by the existing QuokkaCompany/tools Railway Nginx service; see the deployment notes below.

## Interactions and truthful presentation

- The silence playground uses a deterministic illustrative 18.87-second timeline. Threshold, cut restoration and original/edited views change its duration; play animates the timeline silently. This is not live media analysis or an accuracy/performance benchmark.
- Caption styles and EN/KO/JA switch a visual sample with prewritten translations. There are no model calls.
- The product dialog plays the existing actual, silent application recording from `docs/media/walkthrough.mp4`. Generated-speech provenance and omitted waiting time are disclosed. The real editor screenshot comes from `docs/media/silence-editing.png`.
- Local and self-hosted tabs provide copyable commands and prerequisite notes. There is no fake app download, hosted SaaS, testimonial, star count, or email collection.
- The page has no analytics, external fonts, or backend requests. External documentation/GitHub links open only when selected.

Manrope's license is included under `public/landing/`. The landing page uses the existing HyperCut icon. The current Korean editing interface, early-development status and optional provider costs are disclosed.

## Checks

Run `npm run build:landing && npm run test:landing`. The test starts and closes an isolated preview server, unless `HYPERCUT_LANDING_URL` points to an existing preview. It verifies threshold/restoration, silent timeline playback, caption style/language, edition/clipboard controls, FAQ, real video loading, Escape and dialog focus return, 320/390/768px layouts, reduced-motion styling, and absence of external requests/page errors. Screenshots go to ignored `test-output/landing/`.

Local validation on September 7, 2026 passed the production build, all listed browser behaviors, the Docker frontend build, and the existing Go-backed editor browser regression. CI also runs the standalone build and browser checks on Node 24.

## Shared Railway deployment

The production hostname is `hypercut.quokkalabs.net`. The independently maintained
[tools repository](https://github.com/QuokkaCompany/tools) builds the landing page
from the immutable HyperCut commit `d6a9de3fdc9afe702cd44444eb1fc4fcd2d8e1cc`.
Its separate Nginx virtual host serves the landing at the domain root while the
existing tools host keeps its original document root. No HyperCut backend or
video-processing worker is deployed by this integration.

[Deployment PR](https://github.com/QuokkaCompany/tools/pull/2) includes the pinned
build, routing, rollback instructions and automated Docker smoke tests. To ship
landing changes, update the full source pin through a reviewed tools PR; a push
to this repository alone does not update the live marketing page.

Local Docker routing/media checks, all landing browser interactions and mobile
layouts, and tools GitHub Actions passed on September 7, 2026. Railway deployed
merge commit `e2879c40b345ef5fab9eb9be2786332d6d209d8d`. Domain registration and
Hostinger CNAME/TXT records were added. Public HTTPS, MP4 byte-range responses,
and the existing tools pages were verified successfully. The complete landing
browser suite also passed against https://hypercut.quokkalabs.net.
