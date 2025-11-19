// ===============================
//  MISE - Servidor Oficial
//  Versão com CSV STREAMING (não trava, não explode memória)
// ===============================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import readline from "readline";

// Ajustes de caminho
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ------------------------------
//  CONFIG
// ------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===============================
//  FUNÇÕES AUXILIARES
// ===============================

// Corrige números em notação científica
function converterNotacaoCientifica(valor) {
  if (!valor) return '';
  const str = String(valor).trim();

  if (str.includes('E') || str.includes('e')) {
    const num = parseFloat(str);
    return num.toFixed(0).replace(/\.0+$/, '');
  }
  return str;
}

// ===============================
//  CSV STREAMING (LEITURA LINHA A LINHA)
// ===============================
async function buscarNoCSV(codigoBuscado) {
  const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");

  if (!fs.existsSync(csvPath)) return null;

  const stream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({ input: stream });

  let headers = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Primeira linha → cabeçalhos
    if (!headers) {
      headers = trimmed.split(",").map(h => h.trim().toLowerCase());
      continue;
    }

    const colunas = trimmed.split(",");
    const produto = {};

    headers.forEach((h, idx) => {
      produto[h] = colunas[idx]?.trim() || "";
    });

    const codigo = converterNotacaoCientifica(
      produto["cod de barra"] ||
      produto["codigo"] ||
      produto["código"]
    );

    if (codigo === codigoBuscado) {
      rl.close();
      stream.close();
      return produto;
    }
  }

  return null;
}

// ===============================
//  API ONLINE OPENFOODFACTS
// ===============================
async function buscarNaAPI(codigo) {
  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${codigo}.json`;

    const response = await fetch(url, {
      headers: { "User-Agent": "MISE-App-Search" }
    });

    const data = await response.json();

    if (data.status === 1 && data.product) {
      const nome = data.product.product_name || "";
      const marca = data.product.brands || "";
      return marca ? `${nome} - ${marca}` : nome;
    }

    return null;
  } catch (error) {
    console.error("Erro API:", error);
    return null;
  }
}

// ===============================
//  ROTA PARA SERVIR FOTOS
// ===============================
app.get("/foto/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const extensoes = ['.jpg', '.jpeg', '.png', '.webp'];
  const pasta = path.join(__dirname, "public", "fotos");

  if (!fs.existsSync(pasta)) {
    return res.status(404).json({ erro: "Pasta de fotos inexistente" });
  }

  // tenta com _www.mise.ws
  for (const ext of extensoes) {
    const arquivo = path.join(pasta, `${codigo}_www.mise.ws${ext}`);
    if (fs.existsSync(arquivo)) return res.sendFile(arquivo);
  }

  // tenta sem _www.mise.ws
  for (const ext of extensoes) {
    const arquivo = path.join(pasta, `${codigo}${ext}`);
    if (fs.existsSync(arquivo)) return res.sendFile(arquivo);
  }

  res.status(404).json({ erro: "Foto não encontrada" });
});

// ===============================
//  ROTA DE CONSULTA PRINCIPAL
// ===============================
app.get("/consulta/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo.trim();
    console.log("📌 Buscando código:", codigo);

    // 1 — tenta achar no CSV (streaming)
    const produtoCSV = await buscarNoCSV(codigo);

    if (produtoCSV) {
      console.log("✅ Encontrado no CSV!");
      return res.json({
        ok: true,
        produto: produtoCSV,
        origem: "local"
      });
    }

    // 2 — busca online
    console.log("🌐 Não encontrado no CSV. Buscando online...");
    const nome = await buscarNaAPI(codigo);

    if (nome) {
      return res.json({
        ok: true,
        produto: { codigo, nome },
        origem: "online"
      });
    }

    return res.json({
      ok: false,
      mensagem: "Produto não encontrado"
    });

  } catch (e) {
    console.error("ERRO /consulta:", e);
    return res.json({
      ok: false,
      mensagem: "Erro interno"
    });
  }
});

// ===============================
//  SERVE FRONTEND
// ===============================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
//  START SERVER
// ===============================
app.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚀 MISE RODANDO!");
  console.log("📡 Porta:", PORT);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});
