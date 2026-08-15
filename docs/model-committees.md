# User-Defined LLM Committees

Each committee is selected like a model. Members answer in parallel, then the
chair model synthesizes the final response. Committees are defined per-user
under **Settings > Models** and persisted in `user_profiles.model_committees`.

## Creating a committee

- Give the committee a name. The backend assigns a stable `user-committee/...`
  id.
- Pick **2–8 distinct member models** from the available catalog.
- Pick a **chair model** that synthesizes the member answers.
- Committee nesting is not supported from the GUI, so a circular configuration
  cannot be saved.

## Availability

- Committees appear in the Assistant model picker, model preferences, and
  tabular review settings.
- Every member model and the chair must have a usable API key; otherwise the
  committee reports the missing keys instead of silently falling back.
- A personal committee that is deleted (or can no longer be loaded) surfaces an
  error asking the user to select another model.

## Environment-defined committees

Deployment-wide committees can still be defined in `MIKE_MODEL_CONFIG_JSON`
(`committees` array). Those are read-only in the GUI. See the model registry
documentation for the shape.
