import {
  AdvisorChatMessage,
  AdvisorChatRequest,
  AdvisorChatResponse,
} from '@username/shared';

export interface AdvisorServiceOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class AdvisorService {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly customFetch?: typeof fetch;

  constructor(options?: AdvisorServiceOptions) {
    this.apiKey =
      options?.apiKey ||
      process.env.MIRAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.API_KEY;
    this.baseUrl = (
      options?.baseUrl ||
      process.env.MIRAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.miraiapi.com/v1'
    ).replace(/\/+$/, '');
    this.model = options?.model || process.env.AI_MODEL || 'gpt-5.6-luna';
    this.timeoutMs = options?.timeoutMs ?? 15000;
    this.customFetch = options?.fetch;
  }

  async consult(request: AdvisorChatRequest): Promise<AdvisorChatResponse> {
    const lang = request.language || 'ru';
    const messages = request.messages || [];

    if (this.apiKey && this.apiKey.trim().length > 0) {
      try {
        const response = await this.callLlm(messages, lang, request.context);
        return response;
      } catch (err: any) {
        // Safe graceful fallback on LLM failure
        return this.generateFallbackAdvice(messages, lang, request.context, err?.message);
      }
    }

    return this.generateFallbackAdvice(messages, lang, request.context);
  }

  private async callLlm(
    messages: AdvisorChatMessage[],
    lang: string,
    context?: AdvisorChatRequest['context']
  ): Promise<AdvisorChatResponse> {
    const fetchFn = this.customFetch || globalThis.fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const systemPrompt =
      `You are an elite Senior Brand Strategist and Naming Director at Username AI. ` +
      `Your goal is to consult users on naming their startup, product, channel, or personal brand, evaluating names, suggesting high-converting Latin handles, and advising on domains (.com, .ai, .uz) and social platform availability.\n` +
      `Guidelines:\n` +
      `- Language: Always reply in ${lang === 'uz' ? 'Uzbek' : lang === 'ru' ? 'Russian' : 'English'}.\n` +
      `- Structure: Be concise, structured, insightful, and practical. Use bullet points and bold highlights.\n` +
      `- When suggesting candidate names, format them as bold Latin words (e.g. **Lumix**, **Nexora**, **Veltix**), 3-12 characters long, easy to spell.\n` +
      `- Explain the phonetic feeling, industry relevance, and why the name stands out.\n` +
      (context?.query ? `- Current user search context: "${context.query}"\n` : '');

    const chatPayload = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    try {
      const res = await fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: chatPayload,
          temperature: 0.7,
          max_tokens: 1200,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`LLM provider error (${res.status}): ${errorText.slice(0, 150)}`);
      }

      const data = (await res.json()) as any;
      const reply = data?.choices?.[0]?.message?.content?.trim() || '';

      const suggestions = this.extractNameSuggestions(reply);

      return {
        reply,
        suggestions,
        mode: 'AI',
        provider: 'mirai',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Extracts clean candidate names highlighted with bold **name** or quotes from the assistant's reply.
   */
  private extractNameSuggestions(text: string): string[] {
    const boldMatches = [...text.matchAll(/\*\*([A-Za-z0-9_-]{3,20})\*\*/g)].map((m) => m[1]!.toLowerCase());
    const quoteMatches = [...text.matchAll(/["«]([A-Za-z0-9_-]{3,20})["»]/g)].map((m) => m[1]!.toLowerCase());
    const unique = [...new Set([...boldMatches, ...quoteMatches])];
    return unique.filter((name) => !['api', 'com', 'org', 'net', 'http', 'telegram'].includes(name)).slice(0, 8);
  }

  /**
   * High-quality heuristic fallback advisor when AI token is expired or provider is offline.
   */
  private generateFallbackAdvice(
    messages: AdvisorChatMessage[],
    lang: string,
    context?: AdvisorChatRequest['context'],
    errorHint?: string
  ): AdvisorChatResponse {
    const originalUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const lastUserMsg = originalUserMsg.toLowerCase();
    const query = context?.query || '';

    // Specialized advisory responses by topic
    if (lastUserMsg.includes('оцени') || lastUserMsg.includes('оценка') || lastUserMsg.includes('как тебе') || lastUserMsg.includes('baho') || lastUserMsg.includes('rate')) {
      const candidateName = originalUserMsg.match(/["'«]([A-Za-z0-9_-]+)["'»]/)?.[1] || query || 'Nexora';
      const clean = candidateName.replace(/[^a-zA-Z0-9]/g, '');

      let reply = '';
      if (lang === 'uz') {
        reply =
          `### "${clean}" nomi tahlili:\n\n` +
          `1. **Fonetik qulaylik**: Nomi qisqa (${clean.length} belgi), talaffuz qilish va xotirada saqlash oson.\n` +
          `2. **Xalqaro xavfsizlik**: Lotin alifbosida o'qiladi, salbiy assotsiatsiyalarga ega emas.\n` +
          `3. **Domen va brend strategiyasi**: .com band bo'lsa, .ai, .io yoki .uz zonalarini ko'rib chiqish mumkin.\n\n` +
          `Tavsiya qilinadigan variantlar: **${clean.toLowerCase()}hq**, **get${clean.toLowerCase()}**, **${clean.toLowerCase()}lab**.`;
      } else {
        reply =
          `### Экспертная оценка имени **${clean}**:\n\n` +
          `• **Длина и читаемость**: ${clean.length} символов — оптимальная длина для глобального бренда (до 10 знаков легко набираются с клавиатуры смартфона).\n` +
          `• **Фонетика и звучание**: Чёткий ритм, уверенные согласные, легко произносится на русском, узбекском и английском языках.\n` +
          `• **Доменная стратегия**: Если зона \`.com\` уже занята, технологичным проектам отлично подходят зоны \`.ai\`, \`.io\` или локальная зона \`.uz\`.\n` +
          `• **Рекомендация по докрутке**: если прямое имя занято в Telegram, используйте короткие смысловые приставки: **get${clean.toLowerCase()}**, **${clean.toLowerCase()}app**, **${clean.toLowerCase()}hq**.\n\n` +
          `💡 Нажмите на любое имя ниже, чтобы проверить его статус во всех соцсетях и доменах.`;
      }

      return {
        reply,
        suggestions: [clean.toLowerCase(), `get${clean.toLowerCase()}`, `${clean.toLowerCase()}app`, `${clean.toLowerCase()}hq`],
        mode: 'FALLBACK',
      };
    }

    if (lastUserMsg.includes('домен') || lastUserMsg.includes('domen') || lastUserMsg.includes('domain') || lastUserMsg.includes('tld')) {
      let reply = '';
      if (lang === 'uz') {
        reply =
          `### Domen tanlash bo'yicha maslahatlar:\n\n` +
          `• **.com**: Global tan olinish uchun oltin standart. Lekin ko'p nomlar band.\n` +
          `• **.ai**: IT, AI va texnologik loyihalar uchun eng nufuzli zamonaviy zona.\n` +
          `• **.uz**: O'zbekiston ichki bozori va mahalliy auditoriya uchun eng ishonchli tanlov.\n` +
          `• **.io / .co**: Startaplar va developer mahsulotlari uchun qulay muqobil.`;
      } else {
        reply =
          `### Стратегия выбора доменной зоны в 2026 году:\n\n` +
          `1. **.com**: Главный мировой стандарт доверия. Если свободен — берите не раздумывая.\n` +
          `2. **.ai**: Премиальная зона для технологических и продуктовых стартапов (высокий авторитет среди инвесторов).\n` +
          `3. **.uz**: Идеальный выбор для проектов, ориентированных на рынок Узбекистана и Центральной Азии (высокое локальное доверие и хорошая доступность коротких имён).\n` +
          `4. **.io / .app**: Популярные зоны для сервисов, ботов и мобильных приложений.\n\n` +
          `💡 Если зона \`.com\` занята сквоттерами, лучше взять \`.ai\` или \`.uz\` с чистым исходным словом, чем длинный \`.com\` с дефисами.`;
      }

      return {
        reply,
        suggestions: ['nexora', 'cloudpulse', 'aerovault'],
        mode: 'FALLBACK',
      };
    }

    // General branding consultation
    let reply = '';
    if (lang === 'uz') {
      reply =
        `### Naming bo'yicha professional maslahat:\n\n` +
        `Kuchli nom yaratishning 3 ta oltin qoidasi:\n` +
        `1. **Qisqalik**: 4-8 harfdan oshmasin.\n` +
        `2. **Bir xillik**: Telegram, YouTube va domenlarda bir xil band qiling.\n` +
        `3. **Tushunarlilik**: Eshitganda qanday eshitilsa, shunday yoziladigan nomlarni tanlang.\n\n` +
        `Sizga qanday loyiha uchun nom kerak? Sohani yoki asosiy so'zni yozing, men eng mos variantlarni tayyorlab beraman.`;
    } else {
      reply =
        `### Совет от Brand Strategist Username AI:\n\n` +
        `Чтобы название легко запоминалось и продавало ваш продукт:\n` +
        `1. **Принцип одного слова**: Лучшие имена состоят из 4–8 букв (например, **Stripe**, **Linear**, **Vercel**).\n` +
        `2. **Универсальность**: Избегайте сложных транслитераций с шипящими (щ, ц, ж), чтобы имя писалось одинаково на слух.\n` +
        `3. **Синхронность**: Стремитесь занять один и тот же хэндл в Telegram, YouTube и веб-домене.\n\n` +
        `Расскажите подробнее: какая у вас ниша, целевая аудитория и ключевая идея? Я предложу целевые концепции.`;
    }

    return {
      reply,
      suggestions: ['lumina', 'velox', 'synapse', 'zenith'],
      mode: 'FALLBACK',
    };
  }
}
