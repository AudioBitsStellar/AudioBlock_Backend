# AI Features

This document describes the AI-powered features available on AudioBlock, how they work, and how artists can control their participation.

## Overview

AudioBlock offers several AI-driven capabilities designed to enhance discovery, streamline content management, and provide creative tools for artists and listeners.

## Available AI Features

### Smart Recommendations
- **What**: Personalized track and artist recommendations based on listening history, genre preferences, and community engagement.
- **How it works**: A collaborative filtering model analyzes aggregate (anonymized) listening patterns. No individual user data is shared with third parties.
- **Opt-in**: Enabled by default for all users. Artists can opt out of having their tracks included in the recommendation pool.

### Automated Content Tagging
- **What**: Automatic genre, mood, and instrument classification for uploaded tracks.
- **How it works**: An ML model analyzes audio features (tempo, key, spectral profile) to generate metadata tags. Tags appear in the track's public profile.
- **Opt-in**: Enabled by default. Artists may edit or remove auto-generated tags. Opting out reverts to manual tagging only.

### Lyric Analysis
- **What**: Sentiment and theme analysis of song lyrics for search and discovery.
- **How it works**: A natural language processing model processes lyric text (provided by the artist) to extract themes and emotional tone.
- **Opt-in**: Artists must upload lyrics explicitly. The feature is off until lyrics are provided. Opting out deletes any stored analysis.

### Generative Tools (Beta)
- **What**: AI-assisted mastering suggestions, vocal stem separation, and remix idea generation.
- **How it works**: These tools process the artist's own uploaded audio locally or through a secure, ephemeral API call. Audio is not retained after processing.
- **Opt-in**: Explicit opt-in required via the artist dashboard. Each use is individually confirmed.

## Per-Artist Opt-In / Opt-Out

### How to Manage Preferences
1. Navigate to **Artist Dashboard > Settings > AI Preferences**.
2. Toggle each feature independently.
3. Changes take effect immediately (existing cached data is purged within 24 hours).

### Granularity
- **Global toggle**: Disable all AI features for your catalog.
- **Per-feature toggle**: Enable specific features while disabling others.
- **Per-release toggle**: Control AI inclusion on a per-release basis (advanced setting).

### Data Handling on Opt-Out
When an artist opts out:
- Their content is excluded from future AI training and inference pipelines.
- Existing model parameters that were trained on their data are **not** retracted (this is technically infeasible for most ML models), but the artist's data is removed from any active datasets.
- A confirmation email is sent summarizing the opt-out scope.

## Data Privacy and Security

- All AI processing occurs within AudioBlock's infrastructure or via vetted, contract-bound third-party providers.
- Audio content is never shared in raw form with external parties for AI training.
- Aggregate, anonymized usage data may be used to improve AI models; this data cannot be traced back to individual users or artists.
- Artists can request a full data usage report at any time via **Settings > Privacy > AI Data Report**.

## Limitations and Disclaimers

- AI-generated tags and recommendations are probabilistic and may be inaccurate. Artists should review auto-generated metadata.
- Generative tools are in beta and may produce unexpected results. Output is not guaranteed to be commercially viable without further editing.
- Opt-out does not retroactively remove insights derived from aggregate data that has already been incorporated into model weights.

## Further Reading

- [ADR-007: AI Integration Architecture](adrs/007-ai-integration.md)
- [Security Policy](SECURITY_POLICY.md)
- [Environment Variables](environment-variables.md) (see `AI_ENABLED`, `AI_PROVIDER`, etc.)
