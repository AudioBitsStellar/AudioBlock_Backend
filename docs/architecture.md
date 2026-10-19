# AudioBlock Backend Architecture

```mermaid
flowchart LR
    clients[Artist and listener apps] <-->|REST / signed transaction XDR| api[Express API]

    subgraph backend[AudioBlock Backend]
        api --> middleware[Middleware and route controllers]
        middleware --> services[Domain services]
        services --> auth[Auth, users, artists]
        services --> catalog[Songs, albums, marketplace, royalties]
        services --> ai[AI generation and AI Studio]
        services --> webhooks[Webhooks and notifications]
        services --> relay[Soroban transaction relay]

        api --> songQueue[RabbitMQ song_processing]
        songQueue --> songWorker[Song processor worker]
        songWorker --> ffmpeg[FFmpeg HLS transcoding]

        ai --> redisJobs[Redis job queues]
        redisJobs --> aiWorker[AI job worker]
        aiWorker --> providers[Configured AI providers]

        api --> db[(PostgreSQL / TypeORM)]
        services --> db
        api --> redis[(Redis cache and auth state)]
        services --> redis
        songWorker --> s3[(S3 object storage)]
        ffmpeg --> songWorker
        songWorker --> ipfs[Pinata / IPFS metadata]
        services --> s3
        relay --> soroban[Soroban RPC]

        indexer[Standalone Soroban indexer] --> soroban
        indexer --> db
        indexer --> projections[Event projector]
        projections --> db

        api --> metrics[Backend /metrics]
        indexer --> indexerMetrics[Indexer metrics :9464]
        api --> logs[Structured container logs]
    end

    clients -->|wallet signs XDR| wallet[Stellar wallet]
    wallet -->|signed XDR| api
    soroban --> stellar[Stellar network and contracts]
    providers --> aiVendors[External AI services]
    services -. legacy EVM wallet integration .-> dynamic[Dynamic Labs]

    subgraph monitoring[Monitoring profile]
        prometheus[Prometheus] --> grafana[Grafana dashboards]
        promtail[Promtail] --> loki[Loki]
    end
    metrics --> prometheus
    indexerMetrics --> prometheus
    logs --> promtail

    classDef app fill:#e8f2ff,stroke:#2563eb,color:#102a43
    classDef worker fill:#e8f7ef,stroke:#25855a,color:#173b2b
    classDef infra fill:#fff4df,stroke:#b66b00,color:#49300b
    class api,middleware,services,auth,catalog,ai,webhooks,relay app
    class songWorker,aiWorker,indexer,projections worker
    class db,redis,redisJobs,s3,songQueue,soroban,metrics,indexerMetrics,prometheus,grafana,promtail,loki infra
```

The API can start without RabbitMQ; song processing remains unavailable until
the queue and worker connect. AI jobs are independently queued through Redis.
The indexer runs as a separate process and can be disabled with
`INDEXER_ENABLED`. For on-chain writes, the client wallet signs the prepared
transaction; the backend relays signed XDR and never holds the artist's Stellar
secret key. Prometheus alert rules are maintained in
[`monitoring/prometheus-alerts.yml`](../monitoring/prometheus-alerts.yml).
