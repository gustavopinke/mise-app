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
    fs.writeFileSync(filePath, "codigo,nome\n");
    return { headers: ["codigo", "nome"], produtos: [] };
  }
  
  const csv = fs.readFileSync(filePath, "utf8");
  const linhas = csv.split('\n').filter(l => l.trim());
  
  if (linhas.length === 0) {
    return { headers: ["codigo", "nome"], produtos: [] };
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

function salvarNoCSV(filePath, codigo, nome) {
  const { produtos } = lerCSV(filePath);
  const existe = produtos.find(p => p.codigo === codigo);
  
  if (existe) return false;
  
  const nomeLimpo = nome.replace(/,/g, ' ').replace(/"/g, '');
  const linha = `${codigo},${nomeLimpo}\n`;
  fs.appendFileSync(filePath, linha);
  return true;
}

app.get("/consulta/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo;
    const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");

    if (!fs.existsSync(path.dirname(csvPath))) {
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    }

    const { produtos } = lerCSV(csvPath);
    const produtoLocal = produtos.find(p => p.codigo === codigo);

    if (produtoLocal) {
      return res.json({
        ok: true,
        produto: produtoLocal,
        origem: "local"
      });
    }

    console.log(`Buscando ${codigo} no Cosmos...`);
    
    const cosmosResponse = await fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`);
    const cosmosData = await cosmosResponse.json();

    if (cosmosData.status === 1 && cosmosData.product) {
      const nome = cosmosData.product.product_name || "Produto sem nome";
      const marca = cosmosData.product.brands || "";
      const nomeCompleto = marca ? `${nome} - ${marca}` : nome;
      
      const salvou = salvarNoCSV(csvPath, codigo, nomeCompleto);
      
      return res.json({
        ok: true,
        produto: {
          codigo: codigo,
          nome: nomeCompleto
        },
        origem: "cosmos",
        salvo: salvou
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