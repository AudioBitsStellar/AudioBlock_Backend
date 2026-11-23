"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeAiProvider = exports.FakeAIAdapter = void 0;
exports.createFakeAIProviderService = createFakeAIProviderService;
exports.installFakeAi = installFakeAi;
/**
 * Shared AI test doubles (issue #287).
 *
 * AI feature tests must never reach a real provider: live calls cost money,
 * are flaky, and need secrets CI does not have. Every AI feature test uses
 * one of these fakes instead of hand-rolling its own adapter:
 *
 * - `FakeAIAdapter` implements `IAIAdapter` — install it on `AIProviderService`
 *   (TagSuggestionService, PlaylistService curation, ...).
 * - `FakeAiProvider` implements `AiProvider` — install it with
 *   `setAiProviderForTests` (AiGenerationService, TweetDraftService,
 *   ReportService triage, ...).
 *
 * Both record every call, return deterministic output, and can be told to
 * fail or to add latency (the latter is used by the concurrency benchmark in
 * scripts/load-test-ai-concurrency.ts). `scripts/check-ai-test-isolation.js`
 * fails CI if a test defines its own adapter/provider instead of using these.
 */
const AIProviderService_1 = require("../../src/services/AI/AIProviderService");
const ai_1 = require("../../src/services/ai");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class FakeAiBase {
    constructor(options = {}) {
        this.options = options;
        /** Every call made, in order. */
        this.calls = [];
        /** Calls currently awaiting a response — used to measure concurrency. */
        this.inFlight = 0;
        /** Highest `inFlight` value observed since construction / `reset()`. */
        this.maxInFlight = 0;
    }
    /** Change latency/failure behaviour mid-test. */
    configure(options) {
        this.options = { ...this.options, ...options };
    }
    reset() {
        this.calls.length = 0;
        this.inFlight = 0;
        this.maxInFlight = 0;
    }
    callsTo(method) {
        return this.calls.filter((c) => c.method === method).map((c) => c.input);
    }
    async run(method, input, respond) {
        this.calls.push({ method, input });
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
            if (this.options.latencyMs)
                await sleep(this.options.latencyMs);
            if (this.options.failWith)
                throw this.options.failWith;
            return respond();
        }
        finally {
            this.inFlight--;
        }
    }
}
/** Fake for the adapter-based `AIProviderService` layer (src/services/AI). */
class FakeAIAdapter extends FakeAiBase {
    constructor(options = {}) {
        super(options);
        this.name = 'fake';
        /** Text returned by `generateText`; a function receives the call's options. */
        this.textResponse = 'fake response';
        if (options.textResponse !== undefined)
            this.textResponse = options.textResponse;
    }
    async generateText(options) {
        return this.run('generateText', options, () => ({
            text: typeof this.textResponse === 'function' ? this.textResponse(options) : this.textResponse,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }));
    }
    async generateImage(options) {
        return this.run('generateImage', options, () => ({
            images: Array.from({ length: options.n || 1 }, (_, i) => ({
                url: `https://fake-ai.test/image-${i + 1}.png`,
            })),
        }));
    }
    async embed(options) {
        const inputs = Array.isArray(options.text) ? options.text : [options.text];
        return this.run('embed', options, () => ({
            embeddings: inputs.map((t) => [t.length, 0.5, 0.25]),
        }));
    }
}
exports.FakeAIAdapter = FakeAIAdapter;
/** Fake for the domain-level `AiProvider` interface (src/services/ai). */
class FakeAiProvider extends FakeAiBase {
    constructor() {
        super(...arguments);
        this.name = 'fake';
        /** Lyrics returned by `transcribeLyrics`. */
        this.lyrics = 'fake transcribed lyrics';
    }
    async generateCoverArt(input) {
        return this.run('generateCoverArt', input, () => ({
            imageUrl: `https://fake-ai.test/cover/${input.songId}.png`,
            provider: this.name,
        }));
    }
    async generateDescription(input) {
        return this.run('generateDescription', input, () => ({
            description: `Fake description for "${input.title}"`,
            provider: this.name,
        }));
    }
    async draftTweet(input) {
        return this.run('draftTweet', input, () => ({
            text: `${input.artistName} released "${input.title}"`,
            provider: this.name,
        }));
    }
    async scoreContentReport(input) {
        return this.run('scoreContentReport', input, () => ({
            severityScore: 50,
            suggestedPriority: 'medium',
            categories: ['fake'],
            provider: this.name,
        }));
    }
    async embed(input) {
        return this.run('embed', input, () => ({
            embedding: [input.text.length, 0.5, 0.25],
            model: 'fake-embedding',
            provider: this.name,
        }));
    }
    async transcribeLyrics(input) {
        return this.run('transcribeLyrics', input, () => ({
            lyrics: this.lyrics,
            language: input.language,
            provider: this.name,
        }));
    }
}
exports.FakeAiProvider = FakeAiProvider;
/** An `AIProviderService` wired to a fresh `FakeAIAdapter`. */
function createFakeAIProviderService(options) {
    const adapter = new FakeAIAdapter(options);
    return { service: new AIProviderService_1.AIProviderService(adapter), adapter };
}
/**
 * Installs fakes behind both global AI entry points — the
 * `getAIProviderService()` singleton and `getAiProvider()` — so code that
 * resolves its provider internally also hits the fake.
 */
function installFakeAi(options = {}) {
    const adapter = new FakeAIAdapter(options);
    const provider = new FakeAiProvider(options);
    (0, AIProviderService_1.getAIProviderService)().setAdapter(adapter);
    (0, ai_1.setAiProviderForTests)(provider);
    return { adapter, provider };
}
