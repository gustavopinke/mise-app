import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function lerCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    return { headers: [], produtos: [] };
  }
  
  const csv = fs.readFileSync(filePath, "utf8");
  const linhas = csv.split('\n').filter(l => l.trim());
  
  if (linhas.length === 0) {
    return { headers: [], produtos: [] };
  }
  
  const headers = linhas[0].split(',').map(h => h.trim().toLowerCase());
  const produtos = [];
  
  for (let i = 1; i < linhas.length; i++) {
    const valores = linhas[i].split(',');
    if (valores.length >= 2) {
      const produto = {};
      headers.forEach((header, idx) => {
        produto[header] = valores[idx] ? valores[idx].trim() : "";
      });
      produtos.push(produto);
    }
  }
  
  return { headers, produtos };
}

function lerJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]");
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function salvarJSON(filePath, produtos) {
  fs.writeFileSync(filePath, JSON.stringify(produtos, null, 2));
}

app.get("/consulta/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo;
    const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");
    const jsonPath = path.join(__dirname, "data", "produtos.json");

    // 1. BUSCAR NO CSV PRIMEIRO
    const { produtos: produtosCSV } = lerCSV(csvPath);
    const produtoCSV = produtosCSV.find(p => {
      const codigoCSV = p['cod de barra'] || p['codigo'] || p['código'];
      return codigoCSV === codigo;
    });

    if (produtoCSV) {
      return res.json({
        ok: true,
        produto: produtoCSV,
        origem: "local"
      });
    }

    // 2. BUSCAR NO COSMOS
    console.log(`Código ${codigo} não encontrado no CSV. Buscando no Cosmos...`);
    
    const cosmosResponse = await fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`);
    const cosmosData = await cosmosResponse.json();

    if (cosmosData.status === 1 && cosmosData.product) {
      const nome = cosmosData.product.product_name || "Produto sem nome";
      const marca = cosmosData.product.brands || "";
      const nomeCompleto = marca ? `${nome} - ${marca}` : nome;
      
      // 3. SALVAR NO produtos.json
      const produtosJSON = lerJSON(jsonPath);
      const existe = produtosJSON.find(p => p.codigo === codigo);
      
      if (!existe) {
        produtosJSON.push({
          codigo: codigo,
          nome: nomeCompleto
        });
        salvarJSON(jsonPath, produtosJSON);
      }
      
      return res.json({
        ok: true,
        produto: {
          codigo: codigo,
          nome: nomeCompleto
        },
        origem: "cosmos",
        salvo: !existe
      });
    }

    return res.json({ 
      ok: false, 
      mensagem: "Produto não encontrado" 
    });

  } catch (e) {
    console.error(e);
    return res.json({ 
      ok: false, 
      mensagem: "Erro ao consultar" 
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MISE rodando na porta ${PORT}`);
});