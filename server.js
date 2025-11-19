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

// =================== FUNÇÕES DE NORMALIZAÇÃO ===================

function normalizarTexto(texto) {
  if (!texto) return '';
  
  return String(texto)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/\./g, '') // Remove pontos
    .replace(/\s+/g, ' ') // Normaliza espaços
    .trim();
}

function converterNotacaoCientifica(valor) {
  if (!valor) return '';
  const str = String(valor).trim();
  
  // Remove espaços
  let limpo = str.replace(/\s/g, '');
  
  // Se tiver E+ ou e+ (notação científica)
  if (limpo.includes('E+') || limpo.includes('e+') || limpo.includes('E-') || limpo.includes('e-')) {
    const num = parseFloat(limpo);
    if (!isNaN(num)) {
      // Converter para inteiro sem decimais
      return num.toFixed(0).replace(/\.0+$/, '');
    }
  }
  
  return limpo;
}

function normalizarCodigo(codigo) {
  if (!codigo) return '';
  
  // Converter para string e limpar
  let limpo = String(codigo).trim();
  
  // Remover espaços e caracteres especiais
  limpo = limpo.replace(/\s/g, '').replace(/[^\d.eE+-]/g, '');
  
  // Converter notação científica
  limpo = converterNotacaoCientifica(limpo);
  
  // Remover zeros à esquerda (mas manter se for só zeros)
  if (limpo && limpo !== '0') {
    limpo = limpo.replace(/^0+(?=\d)/, '');
  }
  
  return limpo;
}

// =================== LEITURA DO CSV ===================

function lerCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  CSV não encontrado: ${filePath}`);
    return { headers: [], headersOriginais: [], produtos: [] };
  }
  
  const csv = fs.readFileSync(filePath, "utf8");
  const linhas = csv.split('\n').filter(l => l.trim());
  
  if (linhas.length === 0) {
    console.log('⚠️  CSV vazio!');
    return { headers: [], headersOriginais: [], produtos: [] };
  }
  
  // Ler cabeçalho
  const headersOriginais = linhas[0].split(';').map(h => h.trim());
  const headers = headersOriginais.map(h => normalizarTexto(h));
  
  console.log(`\n📄 Lendo CSV: ${linhas.length - 1} linhas`);
  console.log(`📋 Cabeçalhos originais: ${headersOriginais.join(' | ')}`);
  console.log(`📋 Cabeçalhos normalizados: ${headers.join(' | ')}`);
  
  const produtos = [];
  
  for (let i = 1; i < linhas.length; i++) {
    const valores = linhas[i].split(';');
    if (valores.length < 2) continue;
    
    const produto = {};
    const produtoOriginal = {};
    
    headersOriginais.forEach((headerOriginal, idx) => {
      let valor = valores[idx] ? valores[idx].trim() : '';
      
      // Guardar valor original
      produtoOriginal[headerOriginal] = valor;
      
      // Converter código na primeira coluna
      if (idx === 0) {
        const codigoOriginal = valor;
        valor = normalizarCodigo(valor);
        
        if (codigoOriginal !== valor) {
          console.log(`   🔄 Código convertido: ${codigoOriginal} → ${valor}`);
        }
      }
      
      // Guardar com header normalizado
      produto[headers[idx]] = valor;
      produto[headerOriginal] = produtoOriginal[headerOriginal]; // Manter original também
    });
    
    produtos.push(produto);
  }
  
  console.log(`✅ ${produtos.length} produtos carregados\n`);
  
  // Mostrar primeiros 3 produtos para debug
  if (produtos.length > 0) {
    console.log('📦 PRIMEIROS 3 PRODUTOS:');
    for (let i = 0; i < Math.min(3, produtos.length); i++) {
      const p = produtos[i];
      const codigo = p[headers[0]];
      const nome = p[headers[1]];
      console.log(`   ${i+1}. Código: ${codigo} | Produto: ${nome}`);
    }
    console.log('');
  }
  
  return { headers, headersOriginais, produtos };
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

// =================== BUSCA NA API ===================

async function buscarNaAPI(codigo) {
  try {
    console.log(`🌐 Buscando ${codigo} na API...`);
    
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const data = await response.json();
    
    if (data.status === 1 && data.product) {
      const nome = data.product.product_name || "";
      const marca = data.product.brands || "";
      const resultado = marca ? `${nome} - ${marca}` : nome;
      console.log(`✅ Encontrado na API: ${resultado}`);
      return resultado;
    }
    
    console.log(`❌ Não encontrado na API`);
    return null;
  } catch (error) {
    console.error('❌ Erro ao buscar na API:', error.message);
    return null;
  }
}

// =================== ROTAS ===================

// ROTA PARA SERVIR FOTOS
app.get("/foto/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const extensoes = ['.jpg', '.jpeg', '.png', '.webp'];
  const pastaFotos = path.join(__dirname, "public", "fotos");
  
  if (!fs.existsSync(pastaFotos)) {
    fs.mkdirSync(pastaFotos, { recursive: true });
  }
  
  // Tentar com sufixo _www.mise.ws
  for (const ext of extensoes) {
    const nomeArquivo = `${codigo}_www.mise.ws${ext}`;
    const caminhoFoto = path.join(pastaFotos, nomeArquivo);
    
    if (fs.existsSync(caminhoFoto)) {
      return res.sendFile(caminhoFoto);
    }
  }
  
  // Tentar sem sufixo
  for (const ext of extensoes) {
    const nomeArquivo = `${codigo}${ext}`;
    const caminhoFoto = path.join(pastaFotos, nomeArquivo);
    
    if (fs.existsSync(caminhoFoto)) {
      return res.sendFile(caminhoFoto);
    }
  }
  
  res.status(404).json({ erro: "Foto não encontrada" });
});

// ROTA DE CONSULTA
app.get("/consulta/:codigo", async (req, res) => {
  try {
    const codigoOriginal = req.params.codigo.trim();
    const codigo = normalizarCodigo(codigoOriginal);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔍 BUSCA RECEBIDA: ${codigoOriginal}`);
    if (codigo !== codigoOriginal) {
      console.log(`📝 Código normalizado: ${codigo}`);
    }
    
    const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");
    const jsonPath = path.join(__dirname, "data", "produtos.json");

    // 1. BUSCAR NO CSV
    console.log('\n1️⃣ Buscando no CSV...');
    const { headers, headersOriginais, produtos } = lerCSV(csvPath);
    
    if (produtos.length === 0) {
      console.log('❌ CSV vazio ou não encontrado');
    } else {
      // Tentar encontrar produto
      for (const produto of produtos) {
        // Buscar código em várias colunas possíveis
        const possiveisCodigoColunas = [
          'cod de barra',
          'cod de barras', 
          'codigo de barra',
          'codigo',
          'ean',
          'gtin',
          headers[0] // Primeira coluna
        ];
        
        let codigoProduto = '';
        
        for (const coluna of possiveisCodigoColunas) {
          if (produto[coluna]) {
            codigoProduto = normalizarCodigo(produto[coluna]);
            break;
          }
        }
        
        if (!codigoProduto) {
          // Tentar primeira coluna com header original
          codigoProduto = normalizarCodigo(produto[headersOriginais[0]]);
        }
        
        if (codigoProduto === codigo) {
          console.log(`✅ ENCONTRADO NO CSV!`);
          console.log(`📦 Código encontrado: ${codigoProduto}`);
          
          // Pegar nome do produto
          const possivelNome = produto[headers[1]] || produto[headersOriginais[1]] || produto['produto'] || produto['nome'] || 'Produto';
          console.log(`📦 Produto: ${possivelNome}`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          
          // Retornar produto com dados originais
          const produtoResposta = {};
          headersOriginais.forEach((header, idx) => {
            const headerNormalizado = headers[idx];
            produtoResposta[header] = produto[header] || produto[headerNormalizado] || '';
          });
          
          return res.json({
            ok: true,
            produto: produtoResposta,
            origem: "local"
          });
        }
      }
      
      console.log(`❌ Código ${codigo} não encontrado no CSV`);
      console.log(`   Total de produtos verificados: ${produtos.length}`);
    }

    // 2. BUSCAR NA API
    console.log('\n2️⃣ Buscando online...');
    const nome = await buscarNaAPI(codigo);

    if (nome) {
      const produtosJSON = lerJSON(jsonPath);
      const existe = produtosJSON.find(p => normalizarCodigo(p.codigo) === codigo);
      
      if (!existe) {
        produtosJSON.push({ codigo: codigo, nome: nome });
        salvarJSON(jsonPath, produtosJSON);
        console.log(`💾 Salvo em produtos.json`);
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      return res.json({
        ok: true,
        produto: { codigo: codigo, nome: nome },
        origem: "online",
        salvo: !existe
      });
    }

    console.log(`❌ Produto não encontrado em nenhuma fonte`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return res.json({ 
      ok: false, 
      mensagem: "Produto não encontrado" 
    });

  } catch (e) {
    console.error('❌ ERRO:', e);
    return res.json({ 
      ok: false, 
      mensagem: "Erro ao consultar" 
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =================== INICIAR SERVIDOR ===================

app.listen(PORT, () => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 MISE RODANDO!');
  console.log(`📡 Porta: ${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Verificar arquivos na inicialização
  const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");
  if (fs.existsSync(csvPath)) {
    console.log('✅ CSV encontrado! Carregando preview...');
    lerCSV(csvPath);
  } else {
    console.log('⚠️  CSV NÃO encontrado em:', csvPath);
  }
});
