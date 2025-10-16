import 'dotenv/config'; 
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

// --- Variáveis de Ambiente e Inicialização ---
if (!process.env.API_KEY_GEMINI) {
    // 🛑 CORREÇÃO 1: Não use process.exit() no Serverless. Apenas logamos e lançamos um erro.
    console.error("ERRO: A variável de ambiente API_KEY_GEMINI não está definida.");
}

let ai;
try {
    ai = new GoogleGenAI({
        apiKey: process.env.API_KEY_GEMINI
    });
} catch (e) {
    // Apenas loga o erro, permitindo que as rotas de GET ainda funcionem
    console.error("Falha ao inicializar o GoogleGenAI:", e.message);
}

const model = "gemini-2.5-flash";

// Objeto para armazenar as sessões de chat ativas, indexadas pelo sessionId
const activeGameSessions = new Map();

// --- Configuração do Servidor Express ---
const app = express();
const port = process.env.PORT || 3000; 

app.use(cors()); 
app.use(express.json()); 

/**
 * Cria ou recupera uma ChatSession para uma partida específica.
 */
function createOrGetChatSession(sessionId, cor_ia) {
    if (activeGameSessions.has(sessionId)) {
        return activeGameSessions.get(sessionId);
    }
    // Instrução do sistema para o Gemini
    const systemInstruction = `
        Você é um jogador de xadrez nivel 1800 ELO. Você joga como as peças ${cor_ia}.
        Seu objetivo é jogar a melhor jogada estratégica possível.
        Responda SOMENTE NA SUA VEZ e SEMPRE com a jogada no formato 'origemdestino' (ex: e2e4, e NUNCA use 'exd5' 
        como movimento de captura, use e4d5 e tambem não descreva o movimento com a inicial da peça 
        ex: 'nc8c6' somente responda no formato origemdestino 'c8c6'), 
        e um comentario breve sobre a jogada.
        Use o histórico da conversa para manter a estratégia e o plano de jogo.
    `;

    const newChat = ai.chats.create({
        model: model,
        config: {
            systemInstruction: systemInstruction,
            temperature: 0.1
        }
    });

    activeGameSessions.set(sessionId, newChat);
    console.log(`Nova ChatSession criada para o ID: ${sessionId}`);
    
    return newChat;
}

// --- Rota Raiz (Para evitar 404) ---
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: "OK", 
        message: `Chess AI Backend (Porta: ${port}) está online!`,
        endpoint_ia: "/api/jogada-ia (POST)",
        status_gemini: ai ? "Pronto" : "Erro de Chave API"
    });
});


// --- Rota da IA de Xadrez ---
app.post('/api/jogada-ia', async (req, res) => {
    if (!ai) {
        return res.status(500).json({ error: "Erro de Configuração: API_KEY_GEMINI não está definida ou é inválida." });
    }

    const { fen, cor_ia, sessionId } = req.body;

    if (!fen || !cor_ia || !sessionId) {
        return res.status(400).json({ error: "FEN, cor_ia e sessionId são obrigatórios." });
    }

    try {
        // 1. Recupera ou cria a sessão de chat (com contexto)
        const chat = createOrGetChatSession(sessionId, cor_ia);

        // 2. A mensagem do usuário
        const prompt = `A posição FEN atual é: ${fen}. Faça a sua jogada.`;

        console.log(`ID: ${sessionId} | A calcular jogada para ${cor_ia}...`);

        // 3. Enviar mensagem para a sessão de chat
        const response = await chat.sendMessage({
            message: prompt
        });

        // O Gemini devolverá a jogada (ex: "g1f3")
        const movimento = response.text.trim().toLowerCase();

        // 4. Devolver a jogada ao front-end
        console.log(`ID: ${sessionId} | Gemini devolveu: ${movimento}`);
        res.json({ movimento: movimento });

    } catch (error) {
        console.error("Erro na chamada à API Gemini:", error);
        
        // Em caso de erro, remove a sessão para forçar a criação de uma nova
        activeGameSessions.delete(sessionId);
        
        return res.status(500).json({ 
            error: "Erro interno do servidor ao consultar a IA.", 
            details: error.message 
        });
    }
});

// --- Rota para Limpar a Sessão ---
app.post('/api/fim-partida', (req, res) => {
    const { sessionId } = req.body;
    if (activeGameSessions.has(sessionId)) {
        activeGameSessions.delete(sessionId);
        return res.json({ message: `Sessão ${sessionId} removida com sucesso.` });
    }
    res.status(404).json({ message: "Sessão não encontrada." });
});


// --- Iniciar o Servidor ---
export default app;
