# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Someone hunting for a rental apartment in central Tel Aviv who is a member of many Facebook apartment groups and cannot read them all. They open the dashboard to triage new posts, and get pinged on Telegram when a strong match appears. (Inferred: primary user is the repo owner; whether friends or the public will install it is undecided.)

## Product Purpose
A Chrome extension that reads the user's own Facebook apartment groups (read-only), parses each post into price, rooms, bathrooms, neighbourhood and bonuses, scores it against the user's criteria, and shows every listing in a dashboard, with Telegram alerts for matches. Success: the user sees a good apartment before others do, without scrolling Facebook.

## Positioning
Turns messy, free-text Facebook group posts (the place most TLV rentals actually appear first) into structured, filterable listings, using the user's own logged-in session. No neighbouring listing site covers these groups.

## Operating Context
Chrome on a Mac kept open; a small Chrome window opens during scans. Surfaces: dashboard (listings grid with tabs match / review / all / saved / hidden, filters, sort), settings drawer (Telegram token + chat id, criteria, groups, interval, on/off, diagnostics), scan status and progress, toolbar action, Telegram alert messages. Listing fields: price (₪/month), rooms, bathrooms, neighbourhoods (לב העיר, נווה צדק, כרם התימנים, רוטשילד…), bonuses (חניה, מרפסת, ממ״ד, מעלית, משופצת, מרוהטת, חיות), original post text, image, group name, posted time, status + reasons, saved/hidden.

## Capabilities and Constraints
Plain HTML/CSS/JS Chrome MV3 extension, no build step, no external network beyond Facebook and Telegram (fonts must be bundled locally). Read-only on Facebook. Parsing is heuristic: any field can be missing and must render as unknown, not zero. Requested scope: listings with full info, settings, live status, toolbar popup, Telegram alerts.

## Brand Commitments
Name: Messiah TLV APT Hunter (same name in Hebrew and English). Language: Hebrew RTL by default with an English toggle.

## Evidence on Hand
Real listings come from the user's Facebook groups at runtime; none are committed. Mockups must label demo listings as demo.

## Product Principles
- Speed to a decision: price, rooms, area visible before anything else.
- Unknown is honest: never hide that the parser could not read a field.
- The original post is the truth; always one tap away.
- Calm when idle, loud only for a real match.

## Accessibility & Inclusion
Bidirectional text (Hebrew with Latin URLs, numbers, tokens) must render correctly in both directions.
