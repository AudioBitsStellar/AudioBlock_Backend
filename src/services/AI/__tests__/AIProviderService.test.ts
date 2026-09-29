import {
  AIProviderService,
  IAIAdapter,
  GenerateTextOptions,
  GenerateTextResult,
  GenerateImageOptions,
  GenerateImageResult,
  EmbedOptions,
  EmbedResult,
  MockAIAdapter,
} from '../AIProviderService';

class FakeAIAdapter implements IAIAdapter {
  readonly name = 'fake-custom-provider';
  public generateTextCalledWith: GenerateTextOptions[] = [];
  public generateImageCalledWith: GenerateImageOptions[] = [];
  public embedCalledWith: EmbedOptions[] = [];

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.generateTextCalledWith.push(options);
    return {
      text: `Custom AI text response for: ${options.prompt}`,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    };
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    this.generateImageCalledWith.push(options);
    return {
      images: [{ url: 'https://fake-cdn.example.com/generated-art.png' }],
    };
  }

  async embed(options: EmbedOptions): Promise<EmbedResult> {
    this.embedCalledWith.push(options);
    return {
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
    };
  }
}

describe('AIProviderService (Issue #268)', () => {
  it('should initialize with default MockAIAdapter when no adapter is provided', () => {
    const service = new AIProviderService();
    expect(service.getAdapter().name).toBe('mock');
  });

  it('should support swapping the adapter with zero caller changes', async () => {
    const service = new AIProviderService(new MockAIAdapter());
    expect(service.getAdapter().name).toBe('mock');

    const fakeAdapter = new FakeAIAdapter();
    service.setAdapter(fakeAdapter);
    expect(service.getAdapter().name).toBe('fake-custom-provider');

    const textResult = await service.generateText({ prompt: 'Test prompt' });
    expect(textResult.text).toBe('Custom AI text response for: Test prompt');
    expect(fakeAdapter.generateTextCalledWith).toHaveLength(1);
    expect(fakeAdapter.generateTextCalledWith[0].prompt).toBe('Test prompt');
  });

  it('should generate text without leaking vendor-specific types', async () => {
    const fakeAdapter = new FakeAIAdapter();
    const service = new AIProviderService(fakeAdapter);

    const result = await service.generateText({
      prompt: 'Summarize release',
      systemPrompt: 'You are an assistant',
      temperature: 0.7,
      maxTokens: 100,
    });

    expect(result).toHaveProperty('text');
    expect(typeof result.text).toBe('string');
    expect(result.usage?.totalTokens).toBe(10);
  });

  it('should generate images with the configured adapter', async () => {
    const fakeAdapter = new FakeAIAdapter();
    const service = new AIProviderService(fakeAdapter);

    const result = await service.generateImage({
      prompt: 'Cyberpunk album cover',
      size: '1024x1024',
      n: 1,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://fake-cdn.example.com/generated-art.png');
    expect(fakeAdapter.generateImageCalledWith[0].prompt).toBe('Cyberpunk album cover');
  });

  it('should generate vector embeddings with the configured adapter', async () => {
    const fakeAdapter = new FakeAIAdapter();
    const service = new AIProviderService(fakeAdapter);

    const result = await service.embed({
      text: 'Ambient chillout soundscape',
    });

    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(fakeAdapter.embedCalledWith[0].text).toBe('Ambient chillout soundscape');
  });

  it('MockAIAdapter should provide deterministic mock completions and embeddings', async () => {
    const mockAdapter = new MockAIAdapter();
    const service = new AIProviderService(mockAdapter);

    const tagResult = await service.generateText({ prompt: 'suggest tags for song' });
    const parsed = JSON.parse(tagResult.text);
    expect(Array.isArray(parsed.genres)).toBe(true);
    expect(Array.isArray(parsed.tags)).toBe(true);

    const embedResult = await service.embed({ text: 'Lo-Fi Chill Beats' });
    expect(embedResult.embeddings[0]).toHaveLength(16);

    const imgResult = await service.generateImage({ prompt: 'Electronic cover', n: 2 });
    expect(imgResult.images).toHaveLength(2);
  });
});
