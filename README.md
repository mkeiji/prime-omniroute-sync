# Prime Agent OmniRoute Model Sync

A Prime Agent extension to discover OmniRoute models and sync only selected providers/models into `~/.prime/agent/models.json`. It preserves other providers. The OmniRoute API key is stored in a separate extension config file with mode `0600`; it is not copied into `models.json`.

## Install locally

From this directory, load it for one run:

```sh
prime-agent -e .
```

Or install it as a package:

```sh
prime-agent package install /absolute/path/to/prime-omniroute-sync
```

In Prime Agent, run `/omniroute setup`. It tests `/v1/models`, shows provider prefixes discovered from IDs such as `openai/gpt-4.1`, and asks which prefixes to keep. Run `/omniroute filters` to set optional model ID globs and whether to include OmniRoute `auto` routing models. Run `/omniroute sync` to re-fetch and apply the saved filters. `/omniroute status` shows the current settings.

## Config behavior

Settings are stored at `~/.prime/agent/extensions/omniroute-model-sync/config.json`. `providers` is a case-insensitive allowlist of model-ID prefixes. `includeModels` is an optional glob allowlist; `excludeModels` always wins. `*` matches any number of characters, `?` matches one character. Provider filtering happens first, before models are written. `auto` and `auto/*` are excluded unless enabled separately.

The extension writes an `omniroute` provider entry at `~/.prime/agent/models.json`, using the OpenAI-compatible `/v1` API. Other provider entries are retained. The extension registers the saved models at startup using the key from its protected config file.

## Scope and limitations

This first version uses model ID prefixes as provider names and expects OmniRoute's `/v1/models` endpoint to return an OpenAI-style `data` array. It uses zero-cost defaults when the catalog does not provide pricing, and conservative default context/output limits when metadata is absent.
