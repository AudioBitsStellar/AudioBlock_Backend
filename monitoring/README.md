# Monitoring

This directory contains Grafana dashboards and Prometheus configuration for monitoring AudioBlock Backend.

## Grafana Dashboards

### Dashboard-as-Code

Dashboards are now managed as code in the `grafana/provisioning/dashboards/` directory. This approach provides:

- **Version control**: Dashboard changes are tracked in Git
- **Reproducibility**: Dashboards are automatically provisioned on Grafana startup
- **Consistency**: Same dashboards across all environments (dev, staging, prod)

### File Structure

```
grafana/
├── dashboards/
│   ├── dashboard.json          # Legacy dashboard (kept for backward compatibility)
│   └── dashboard.yml           # Dashboard provider config
└── provisioning/
    └── dashboards/
        ├── dashboards.yml      # Provisioning configuration
        └── audioblock-backend.json  # Dashboard-as-code definition
```

### Adding New Dashboards

1. Create a new JSON file in `grafana/provisioning/dashboards/`
2. Use the `$job` variable in PromQL queries to filter by service
3. Follow the existing panel structure and styling conventions
4. Test locally with `docker-compose up grafana`

### Key Features of Dashboard-as-Code

- **Template variables**: Use `$job` to filter metrics by service instance
- **Consistent styling**: All panels use the same color palette and thresholds
- **Proper units**: Each panel has appropriate units (reqps, s, short)
- **Legend formatting**: Consistent legend format across panels

## Prometheus

Configuration is in `prometheus.yml`. The backend exposes metrics at `/metrics`.

## Adding New Metrics

1. Instrument your code with Prometheus client libraries
2. Add the metric to the appropriate panel in the dashboard JSON
3. Use the `$job` variable to ensure metrics are properly scoped
