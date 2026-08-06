import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { mentorType, userPrompt } = req.body;
    
    // サーバーの環境変数（VercelのEnvironment Variables）からAPIキーを自動取得・固定化
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        alert("内部エラーが発生しました。エラーステータスは500番台です。");
        return res.status(500).json({ error: 'Server API Key is not configured in environment variables.' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `rate_limit:${clientIp.split(',')[0].trim()}`;

    try {
        const requestCount = await kv.get(rateLimitKey) || 0;
        const DAILY_LIMIT = 20;
        
        if (requestCount >= DAILY_LIMIT) {
            alert(`本日の利用上限が、最大値に達しました (${DAILY_LIMIT}回)。また明日、メンターに会いに来てね！いつでもあなたをお待ちしています！`);
            return res.status(429).json({ 
                error: `本日の利用上限（${DAILY_LIMIT}回）に達しました！また明日、メンターに会いに来てね🍵` 
            });
        }

        let systemInstruction = "";
        if (mentorType === 'heal') {
            systemInstruction = "あなたは慈愛に満ちた優しいメンターです。ユーザーの気持ちに徹底的に寄り添い、全肯定して心から癒やし、明日への活力を与える温かい言葉をかけてください。";
        } else if (mentorType === 'tsun') {
            systemInstruction = "あなたはツンデレなキャラクターです。「べ、別にあんたのために言うわけじゃないんだからね！」といったツンツンした態度を取りつつも、最後にはしっかりユーザーを応援し励ますメッセージを伝えてください。";
        } else if (mentorType === 'sparta') {
            systemInstruction = "あなたは熱血スパルタコーチです。「甘ったれるな！お前ならもっとできるはずだ！」と大きな愛と情熱を持って、力強く背中を叩くように喝を入れて鼓舞してください。";
        } else if (mentorType === 'dark') {
            systemInstruction = "あなたは辛口で少し皮肉屋な毒舌メンターです。しかし本質を突いており、ユーザーがハッと気づきを得られるような、ユーモアと愛のある辛口メッセージを伝えてください。";
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const requestBody = {
            contents: [{ parts: [{ text: systemInstruction + "\n\nユーザーの状況・気分: " + userPrompt }] }]
        };

        const startTime = Date.now();
        const apiResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const duration = Date.now() - startTime;

        if (apiResponse.status === 429) {
            return res.status(429).json({ error: 'Google側でレート制限が発生しました。少し時間を置いてね。' });
        }

        if (!apiResponse.ok) {
            const errData = await apiResponse.json();
            return res.status(apiResponse.status).json({ error: errData.error?.message || 'Gemini API Error' });
        }

        const data = await apiResponse.json();
        const advice = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!advice) {
            throw new Error('Unexpected response format from Gemini.');
        }

        await kv.set(rateLimitKey, Number(requestCount) + 1, { ex: 86400 });

        return res.status(200).json({
            advice,
            usage: data.usageMetadata || {},
            duration,
            remaining: DAILY_LIMIT - (Number(requestCount) + 1)
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
