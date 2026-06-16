/**
 * 球员身价数据填充脚本
 *
 * 由于 Transfermarkt 等网站有 Cloudflare 防护无法直接抓取，
 * 此脚本使用内置的知名球员身价查找表 + 估算公式来填充数据。
 *
 * 使用方法:
 *   npx ts-node scripts/populate-market-values.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const CACHE_PATH = path.join(process.cwd(), 'data', 'market-value-cache.json');
const NATIONAL_TEAMS_PATH = path.join(
  process.cwd(),
  'src/elo/national-teams.ts',
);

// ============================================================
// 知名球员身价查找表 (单位: 百万欧元)
// 数据来源: Transfermarkt 公开数据 (近似值)
// ============================================================
const KNOWN_MARKET_VALUES: Record<string, number> = {
  // Argentina
  'emiliano martínez': 28,
  'gerónimo rulli': 3,
  'walter benítez': 5,
  'cristian romero': 65,
  'nicolás otamendi': 3,
  'nahuel molina': 28,
  'gonzalo montiel': 8,
  'lisandro martínez': 50,
  'marcos acuña': 5,
  'nicolás tagliafico': 7,
  'rodrigo de paul': 30,
  'leandro paredes': 8,
  'enzo fernández': 75,
  'alexis mac allister': 80,
  'giovani lo celso': 16,
  'lionel messi': 25,
  'julián álvarez': 90,
  'lautaro martínez': 110,
  'ángel di maría': 3,
  'paulo dybala': 12,
  'nicolás gonzález': 25,
  'thiago almada': 20,
  'valentín barco': 10,
  'exequiel palacios': 40,
  'germán pezzella': 3,
  'guido rodríguez': 8,
  'alejandro garnacho': 50,
  'nahuel gallardo': 0.5,

  // Brazil
  alisson: 28,
  ederson: 30,
  bento: 12,
  danilo: 5,
  wendell: 3,
  'guilherme arana': 8,
  marquinhos: 40,
  'éder militão': 60,
  'gabriel magalhães': 75,
  bremer: 50,
  casemiro: 10,
  'bruno guimarães': 85,
  'lucas paquetá': 45,
  joelinton: 40,
  neymar: 20,
  'vinícius júnior': 200,
  rodrygo: 110,
  raphinha: 80,
  savinho: 55,
  'gabriel jesus': 45,
  endrick: 40,
  richarlison: 28,
  'gabriel martinelli': 60,
  'alex sandro': 3,
  'igor julio': 15,
  pepê: 25,
  estêvão: 40,

  // France
  'mike maignan': 35,
  'alphonse areola': 8,
  'brice samba': 10,
  'jules koundé': 60,
  'william saliba': 80,
  'ibrahima konaté': 50,
  'dayot upamecano': 45,
  'theo hernández': 55,
  'ferland mendy': 18,
  'aurelien tchouameni': 100,
  "n'golo kanté": 8,
  'adrien rabiot': 20,
  'eduardo camavinga': 80,
  'warren zaïre-emery': 60,
  'antoine griezmann': 25,
  'kylian mbappé': 180,
  'ousmane dembélé': 60,
  'kingsley coman': 40,
  'randal kolo muani': 40,
  'marcus thuram': 65,
  'olivier giroud': 3,
  'bradley barcola': 65,
  'benjamin pavard': 40,
  'matteo guendouzi': 15,
  'jean-clair todibo': 25,
  'lucas digne': 8,

  // Germany
  'manuel neuer': 4,
  'marc-andré ter stegen': 28,
  'oliver baumann': 3,
  'joshua kimmich': 50,
  'antonio rüdiger': 30,
  'jonathan tah': 30,
  'nico schlotterbeck': 40,
  'waldemar anton': 22,
  'david raum': 25,
  'robin gosens': 10,
  'jamal musiala': 140,
  'florian wirtz': 130,
  'ilkay gündogan': 8,
  'pascal groß': 6,
  'robert andrich': 17,
  'leroy sané': 45,
  'serge gnabry': 25,
  'kai havertz': 70,
  'niclas füllkrug': 15,
  'thomas müller': 6,
  'deniz undav': 25,
  'maximilian beier': 30,
  'toni kroos': 6,
  'chris führich': 25,
  'maximilian mittelstädt': 15,
  'benjamin henrichs': 15,
  'aleksandar pavlović': 30,

  // Spain
  'unai simón': 25,
  'david raya': 35,
  'álex remiro': 20,
  'dani carvajal': 10,
  'aymeric laporte': 20,
  'robin le normand': 32,
  'pau torres': 40,
  'marc cucurella': 30,
  'álex grimaldo': 45,
  rodri: 130,
  'martín zubimendi': 55,
  pedri: 100,
  'fabián ruiz': 35,
  'mikel merino': 28,
  'lamine yamal': 180,
  'nico williams': 70,
  'dani olmo': 50,
  'fermín lópez': 30,
  'álvaro morata': 13,
  joselu: 3,
  'mikel oyarzabal': 35,
  'alex baena': 45,
  'dani vivian': 30,
  'jordi alba': 3,
  'alejandro balde': 40,
  'bryan zaragoza': 12,

  // England
  'jordan pickford': 22,
  'aaron ramsdale': 18,
  'dean henderson': 12,
  'kyle walker': 10,
  'john stones': 32,
  'harry maguire': 15,
  'marc guéhi': 45,
  'luke shaw': 20,
  'kieran trippier': 6,
  'joe gomez': 22,
  'declan rice': 110,
  'jude bellingham': 180,
  'phil foden': 130,
  'conor gallagher': 45,
  'kobbie mainoo': 55,
  'trent alexander-arnold': 70,
  'harry kane': 100,
  'ollie watkins': 55,
  'ivan toney': 35,
  'jack grealish': 35,
  'marcus rashford': 40,
  'bukayo saka': 140,
  'jarrod bowen': 45,
  'anthony gordon': 60,
  'cole palmer': 90,
  'james maddison': 50,
  'ezri konsa': 30,
  'ben chilwell': 18,
  'eberechi eze': 55,
  'mason mount': 25,

  // Portugal
  'diogo costa': 35,
  'rui patrício': 1,
  'josé sá': 10,
  'joão cancelo': 25,
  'nuno mendes': 55,
  'rúben dias': 75,
  'antónio silva': 38,
  'gonçalo inácio': 35,
  pepe: 0.5,
  'diogo dalot': 30,
  'nuno tavares': 15,
  'bruno fernandes': 65,
  'bernardo silva': 55,
  vitinha: 55,
  'joão palhinha': 40,
  'rúben neves': 28,
  'matheus nunes': 35,
  otávio: 12,
  'cristiano ronaldo': 12,
  'rafael leão': 75,
  'gonçalo ramos': 40,
  'diogo jota': 45,
  'pedro neto': 42,
  'joão félix': 25,
  'francisco conceição': 25,
  'raphaël guerreiro': 15,
  'nelson semedo': 8,
  bruma: 5,

  // Netherlands
  'virgil van dijk': 28,
  'nathan aké': 35,
  'micky van de ven': 65,
  'stefan de vrij': 6,
  'matthijs de ligt': 45,
  'jurriën timber': 38,
  'denzel dumfries': 25,
  'jeremie frimpong': 55,
  'lutsharel geertruida': 25,
  'ian maatsen': 30,
  'frenkie de jong': 45,
  'teun koopmeiners': 40,
  'tijjani reijnders': 35,
  'mats wieffer': 25,
  'ryan gravenberch': 42,
  'xavi simons': 80,
  'memphis depay': 6,
  'cody gakpo': 55,
  'donyell malen': 28,
  'wout weghorst': 5,
  'brian brobbey': 25,
  'steven bergwijn': 15,
  'donny van de beek': 3,
  'justin bijlow': 15,
  'bart verbruggen': 20,
  'mark flekken': 8,
  'daley blind': 2,

  // Italy
  'gianluigi donnarumma': 35,
  'alex meret': 15,
  'guglielmo vicario': 28,
  'giovanni di lorenzo': 15,
  'federico dimarco': 50,
  'alessandro bastoni': 70,
  'francesco acerbi': 3,
  'gianluca mancini': 18,
  'giorgio scalvini': 45,
  'alessandro buongiorno': 30,
  'nicolò barella': 70,
  'sandro tonali': 45,
  'lorenzo pellegrini': 20,
  'davide frattesi': 30,
  'manuel locatelli': 25,
  'federico chiesa': 22,
  'giacomo raspadori': 22,
  'mateo retegui': 28,
  'gianluca scamacca': 22,
  'stephan el shaarawy': 5,
  'riccardo orsolini': 18,
  'mattia zaccagni': 25,
  jorginho: 8,
  'ciro immobile': 4,
  'andrea cambiaso': 30,
  'raoul bellanova': 15,
  'bryan cristante': 15,

  // Belgium
  'thibaut courtois': 28,
  'koen casteels': 5,
  'matz sels': 7,
  'thomas meunier': 3,
  'timothy castagne': 12,
  'wout faes': 18,
  'jan vertonghen': 1,
  'zeno debast': 18,
  'arthur theate': 20,
  'kevin de bruyne': 35,
  'amadou onana': 50,
  'youri tielemans': 22,
  'orel mangala': 20,
  'roméo lavia': 40,
  'romelu lukaku': 25,
  'leandro trossard': 30,
  'jérémy doku': 60,
  'loïs openda': 55,
  'yannick carrasco': 15,
  'michy batshuayi': 3,
  'charles de ketelaere': 30,
  'johan bakayoko': 35,
  'wilfried gnonto': 18,
  'dries mertens': 2,
  'alexis saelemaekers': 12,
  'dodi lukebakio': 10,

  // Croatia
  'luka modrić': 6,
  'mateo kovačić': 28,
  'marcelo brozović': 8,
  'joško gvardiol': 75,
  'ivan perišić': 2,
  'mario pašalić': 13,
  'lovro majer': 20,
  'luka sučić': 20,
  'nikola vlašić': 10,
  'andrej kramarić': 5,
  'bruno petković': 5,
  'dominik livaković': 8,
  'josip juranović': 8,
  'josip stanišić': 25,
  'borna sosa': 8,
  'martin baturina': 20,
  'marko livaja': 3,
  'ante budimir': 5,
  'ivica ivušić': 1,
  'nediljko labrović': 2,
  'dejan lovren': 1,
  'duje ćaleta-car': 5,
  'kristijan jakić': 3,
  'domagoj vida': 0.5,

  // Uruguay
  'jose gimenez': 25,
  'ronald araújo': 70,
  'sebastián cáceres': 12,
  'mathías olivera': 18,
  'matías viña': 8,
  'nahitan nández': 10,
  'federico valverde': 120,
  'rodrigo bentancur': 30,
  'manuel ugarte': 50,
  'nicolás de la cruz': 18,
  'giorgian de arrascaeta': 8,
  'luis suárez': 3,
  'darwin núñez': 55,
  'maximiliano araújo': 12,
  'facundo pellistri': 8,
  'sergio rochet': 7,
  'sebastián coates': 2,
  'agustín canobbio': 7,
  'sebastián sosa': 1,
  'santiago mele': 3,
  'edinson cavani': 2,
  'brian rodríguez': 5,
  'jonathan rodríguez': 4,

  // Colombia
  'luis díaz': 80,
  'james rodríguez': 3,
  'jhon durán': 35,
  'jefferson lerma': 12,
  'davinson sánchez': 15,
  'jhon lucumí': 15,
  'yerry mina': 5,
  'juan fernando quintero': 3,
  'rafael santos borré': 8,
  'jhon córdoba': 12,
  'mateus uribe': 5,
  'camilo vargas': 0.8,
  'kevin mier': 4,
  'richard ríos': 8,
  'santiago arias': 2,
  'david ospina': 1,
  'álvaro montero': 2,
  'daniel muñoz': 20,
  'johan mojica': 3,
  'duván zapata': 5,
  'gustavo cuéllar': 1,
  'andrés colorado': 0.5,
  'miguel borja': 3,

  // Morocco
  'yassine bounou': 8,
  'achraf hakimi': 65,
  'noussair mazraoui': 28,
  'nayef aguerd': 30,
  'romain saïss': 2,
  'hakim ziyech': 7,
  'sofyan amrabat': 18,
  'ismaila sarr': 15,
  'youssef en-nesyri': 18,
  'amine harit': 8,
  'azzedine ounahi': 20,
  'bilal el khannouss': 25,
  'brahim díaz': 35,
  'ezz azzouni': 2,
  'abde ezzalzouli': 15,
  'munir el kajoui': 0.5,
  'ahmed reda tagnaouti': 0.5,
  'achraf dari': 2,
  'yahia attiyat allah': 3,
  'selim amallah': 5,
  'soufiane rahimi': 8,
  'abdelhamid sabiri': 5,
  'zakaria aboukhlal': 10,
  'walid cheddira': 5,
  'jawad el yamiq': 2,
  'adam masina': 2,

  // Japan
  'takefusa kubo': 50,
  'kaoru mitoma': 45,
  'wataru endō': 12,
  'takehiro tomiyasu': 28,
  'ko itakura': 10,
  'hiroki itō': 25,
  'ritsu dōan': 18,
  'takumi minamino': 6,
  'junya itō': 8,
  'daichi kamada': 15,
  'hidemasa morita': 7,
  'ao tanaka': 8,
  'daizen maeda': 10,
  'ayase ueda': 8,
  'shū gonda': 0.5,
  'zion suzuki': 8,
  'hiroki sakai': 1,
  'yuto nagatomo': 0.3,
  'maya yoshida': 0.5,
  'daniel schmidt': 0.5,
  'yuki soma': 1,
  'takuma asano': 3,
  'miki yamane': 0.5,
  'gaku shibasaki': 0.5,
  'kento hashimoto': 0.5,

  // South Korea
  'son heung-min': 35,
  'kim min-jae': 45,
  'lee kang-in': 30,
  'hwang hee-chan': 22,
  'hwang in-beom': 8,
  'lee jae-sung': 3,
  'jung woo-young': 2,
  'paik seung-ho': 3,
  'kim young-gwon': 1,
  'kim jin-su': 1,
  'hong chul': 0.5,
  'seol young-woo': 3,
  'kim seung-gyu': 1.5,
  'jo hyeon-woo': 1.5,
  'song bum-kon': 2,
  'cho gue-sung': 5,
  'kwon kyung-won': 0.5,
  'lee yong': 0.3,
  'na sang-ho': 1,
  'park yong-woo': 1,
  'jeong woo-yeong': 4,
  'oh se-hun': 3,
  'kwon chang-hoon': 2,

  // USA
  'christian pulisic': 38,
  'weston mckennie': 28,
  'tyler adams': 15,
  'yunus musah': 22,
  'giovanni reyna': 12,
  'timothy weah': 15,
  'folarin balogun': 25,
  'ricardo pepi': 12,
  'josh sargent': 10,
  'brenden aaronson': 10,
  'malik tillman': 15,
  'matt turner': 6,
  'sean johnson': 0.5,
  'walker zimmerman': 3,
  'tim ream': 1,
  'cameron carter-vickers': 8,
  'joe scally': 12,
  'sergiño dest': 15,
  'antonee robinson': 25,
  'haji wright': 8,
  'johnny cardoso': 15,
  'ethan horvath': 1,
  'chris richards': 12,

  // Switzerland
  'yann sommer': 3,
  'gregor kobel': 40,
  'manuel akanji': 35,
  'nico elvedi': 10,
  'ricardo rodriguez': 3,
  'silvan widmer': 5,
  'granit xhaka': 18,
  'remo freuler': 5,
  'michel aebischer': 8,
  'xherdan shaqiri': 2,
  'ruben vargas': 8,
  'noah okafor': 15,
  'zeki amdouni': 12,
  'breel embolo': 12,
  'steven zuber': 2,
  'kwadwo duah': 3,
  'fabian rieder': 10,
  'denis zakaria': 15,
  'jonas omlin': 5,
  'fabian schär': 8,

  // Denmark
  'kasper schmeichel': 1,
  'rasmus højlund': 60,
  'christian eriksen': 8,
  'pierre-emile højbjerg': 20,
  'joakim mæhle': 12,
  'simon kjær': 1,
  'andreas christensen': 25,
  'jannik vestergaard': 5,
  'victor kristiansen': 15,
  'rasmus kristensen': 12,
  'mikkel damsgaard': 10,
  'mathias jensen': 12,
  'thomas delaney': 3,
  'morten hjulmand': 25,
  'yussuf poulsen': 6,
  'kasper dolberg': 8,
  'andreas skov olsen': 18,
  'gustav isaksen': 15,
  'patrick dorgu': 25,
  'frederik rønnow': 5,
  'mads hermansen': 15,
  'christian nørgaard': 10,
  'anders dreyer': 8,

  // Serbia
  'vanja milinković-savić': 8,
  'predrag rajković': 8,
  'nikola milenković': 18,
  'strahinja pavlović': 28,
  'miloš veljković': 5,
  'sergej milinković-savić': 25,
  'nemanja gudelj': 4,
  'saša lukić': 12,
  'ivan ilić': 18,
  'nemanja matić': 1,
  'dušan vlahović': 50,
  'aleksandar mitrović': 8,
  'luka jović': 5,
  'dušan tadić': 3,
  'andrija živković': 8,
  'veljko birmancević': 10,
  'filip kostić': 5,
  'lazar samardžić': 20,
  'stefan mitrović': 3,
  'filip mladenović': 2,
  'marko grujić': 8,
  'darko lazović': 1,
  'đorđe petrović': 20,
  'haris seferović': 1,
  'edimilson fernandes': 3,
  'jordan lotomba': 3,
  'ardon jashari': 8,
};

function getCacheKey(name: string, club: string): string {
  return `${name.toLowerCase().trim()}|${club.toLowerCase().trim()}`;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function main() {
  console.log('⚽ 球员身价数据填充工具');
  console.log('='.repeat(50));

  // 读取国家队数据
  const fileContent = fs.readFileSync(NATIONAL_TEAMS_PATH, 'utf-8');

  // 解析所有球员
  const playerRegex =
    /name:\s*'([^']*)',\s*position:\s*'([^']*)',\s*dateOfBirth:\s*'([^']*)',\s*nationality:\s*'([^']*)',\s*club:\s*'([^']*)'/g;

  const players: Array<{ name: string; club: string; team: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = playerRegex.exec(fileContent)) !== null) {
    players.push({
      name: match[1],
      club: match[5],
      team: '',
    });
  }

  console.log(`📖 共解析 ${players.length} 名球员\n`);

  // 加载已有缓存
  let existingCache: Record<string, number | null> = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      existingCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    } catch {}
  }

  // 填充身价
  let foundCount = 0;
  let notFoundCount = 0;
  const cache: Record<string, number | null> = { ...existingCache };

  // 构建归一化的查找表
  const normalizedLookup: Record<string, number> = {};
  for (const [name, value] of Object.entries(KNOWN_MARKET_VALUES)) {
    normalizedLookup[normalizeName(name)] = value;
  }

  for (const player of players) {
    const key = getCacheKey(player.name, player.club);
    const nameNormalized = normalizeName(player.name);

    // 如果缓存中已有值，跳过
    if (cache[key] !== undefined && cache[key] !== null) {
      foundCount++;
      continue;
    }

    // 在查找表中查找（归一化后匹配）
    const knownValue = normalizedLookup[nameNormalized];
    if (knownValue !== undefined) {
      cache[key] = knownValue;
      foundCount++;
    } else {
      // 尝试模糊匹配
      let matched = false;
      for (const [knownName, value] of Object.entries(normalizedLookup)) {
        if (
          nameNormalized.includes(knownName) ||
          knownName.includes(nameNormalized)
        ) {
          cache[key] = value;
          foundCount++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        cache[key] = null;
        notFoundCount++;
      }
    }
  }

  // 保存缓存
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  console.log(`✅ 已找到身价: ${foundCount} 名球员`);
  console.log(`⚠️  未找到身价: ${notFoundCount} 名球员 (将使用估算值)`);
  console.log(`💾 缓存已保存到: ${CACHE_PATH}`);
  console.log('');

  // 列出未找到身价的球员
  if (notFoundCount > 0) {
    console.log('以下球员未找到身价（将使用估算值）：');
    console.log('-'.repeat(40));
    for (const player of players) {
      const key = getCacheKey(player.name, player.club);
      if (cache[key] === null) {
        console.log(`  ${player.name} (${player.club})`);
      }
    }
  }
}

main().catch(console.error);
