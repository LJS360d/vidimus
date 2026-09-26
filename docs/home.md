---
title: Home
description: Checks a static website's build before it goes public, and tells you how to fix what it finds.
---

## One command, thirteen audits

Accessibility, broken links, responsiveness, SEO, security headers, privacy, HTML validity,
page weight, CSP, i18n, visual regression and Lighthouse. [The audits](./audits/).

## A fix for every finding

Each problem comes with what to do about it, and the config key to silence it when it's
intended.

## Adopt it gradually

Warn instead of fail, ignore known findings, or accept today's findings and fail only on new
ones. [Adopting on an existing site](./adopting).

## Install only what you use

Zero-dependency audits read the build directly; browser audits use the tools you add next to
vidimus. [Getting started](./getting-started).

## Built six times, on purpose

These docs are rendered from the same markdown by VitePress, Starlight, Hugo, Eleventy, Zola
and mdBook, deployed side by side under one origin, cross-linked page by page, and audited by
vidimus as one site. The setup is more complicated than any docs site needs: it exists to
dogfood vidimus against six generators' real output. [How and why](./flavors).
