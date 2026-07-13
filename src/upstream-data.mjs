/**
 * 数据来源：Last-emo-boy/RelationWeb 的 data.js。
 * 上游 URL：https://github.com/Last-emo-boy/RelationWeb/blob/ea9b337492572b8cf63bb9c781fb2ecd70937346/data.js
 * 固定 commit：ea9b337492572b8cf63bb9c781fb2ecd70937346
 *
 * 转换规则：人物按首次出现顺序去重；CURRENT_PARTNER 与 EX_PARTNER 的
 * 双向边分别折叠为一条 mutual partner / dated 边；AFFECTION 保持有向。
 * 上游不包含可靠的年份字段，因此不推断或虚构年份。
 */

const PEOPLE_ROWS = `
p001\t周而成\t男
p002\t刘君明\t女
p003\t沈天阔\t男
p004\t夏印荷\t女
p005\t王伊倩\t女
p006\t楼文颉\t男
p007\t李笑\t女
p008\t郭行健\t男
p009\t万天艺\t女
p010\t王品澄\t男
p011\t尤镜淞\t男
p012\t施与姚\t女
p013\t段佩辰\t男
p014\t王圣涵\t女
p015\t方徐知\t女
p016\t温伽睿\t男
p017\t朱易琳\t女
p018\t赵一玮\t男
p019\t王则元\t男
p020\t陈辰\t女
p021\t李瑞琪\t女
p022\t施展\t男
p023\t方彬羽\t女
p024\t严雍寒\t男
p025\t方晨曦\t女
p026\t张译匀\t女
p027\t黄师然\t男
p028\t陈宣妤\t女
p029\t林验\t男
p030\t董沐言\t女
p031\t葛语歆\t女
p032\t杨佳选\t男
p033\t韦子余\t男
p034\t丁西蒙\t女
p035\t白翰铭\t男
p036\t何晨杰\t男
p037\t张庭尔\t女
p038\t邓屹阳\t男
p039\t张耀天\t男
p040\t顾紫欣\t女
p041\t袁成禹\t男
p042\t张艺霏\t女
p043\t吴瑞麟\t男
p044\t周溪瑜\t女
p045\t陶依婷\t女
p046\t丁鼎钟\t男
p047\t卢政瑞\t男
p048\t王乐其\t女
p049\t孙佳择\t男
p050\t史元岳\t男
p051\t方馨\t女
p052\t张文希\t女
p053\t杨尚融\t男
p054\t李若宁\t女
p055\t李皓宇\t男
p056\t周易诚\t男
p057\t钱若瑜\t女
p058\t郑筑轩\t男
p059\t刘燕霖\t女
p060\t侯思成\t男
p061\t吕韦凝\t女
p062\t陆朵朵\t女
p063\t姚舜禹\t男
p064\t王诗韵\t女
p065\t方谷玚\t男
p066\t吕沁然\t女
p067\t陈予谦\t男
p068\t宋宇轩\t男
p069\t葛恒嘉\t女
p070\t秦汉文\t男
p071\t彭泓钦\t男
p072\t赵倩楠\t女
p073\t林以衡\t女
p074\t朱闻哲\t男
p075\t黄子宸\t男
p076\t楼思越\t女
p077\t张盛洋\t男
p078\t马希予\t女
p079\t王煜菲\t女
p080\t姜一寻\t男
p081\t张津\t男
p082\t赵虹昇\t男
p083\t倪哲晟\t男
p084\t徐嘉一\t女
p085\t于小格\t女
p086\t王联舟\t男
p087\t曹禛\t男
p088\t张扬婧\t女
p089\t康家豪\t男
p090\t冯诗悦\t女
p091\t陈洁如\t女
p092\t姚博文\t男
p093\t肖景元\t男
p094\t张沁媛\t女
p095\t吴弘宇\t男
p096\t王思源\t女
p097\t秦正\t男
p098\t陆宜彬\t男
p099\t姚昕妤\t女
p100\t李晗之\t男
p101\t王辰茵\t女
p102\t陈奕添\t男
p103\t武奇\t男
p104\t吴思涵\t女
p105\t陈昱桐\t男
p106\t姚君竹\t男
p107\t姜艺蕾\t女
p108\t毕文凯\t男
p109\t江潼恩\t女
p110\t李正钰\t女
p111\t梁铸人\t男
p112\t颜子轩\t男
p113\t茅心爱\t女
p114\t钱程浩\t男
p115\t陈宝仪\t女
p116\t林嘉懿\t女
`;

const RELATIONSHIP_ROWS = `
r001\tp001\tp002\tdated\tmutual
r002\tp007\tp008\tdated\tmutual
r003\tp009\tp010\tdated\tmutual
r004\tp011\tp012\tdated\tmutual
r005\tp013\tp014\tdated\tmutual
r006\tp017\tp018\tdated\tmutual
r007\tp019\tp020\tdated\tmutual
r008\tp019\tp021\tdated\tmutual
r009\tp022\tp023\tdated\tmutual
r010\tp024\tp026\tdated\tmutual
r011\tp029\tp030\tdated\tmutual
r012\tp014\tp036\tdated\tmutual
r013\tp037\tp038\tdated\tmutual
r014\tp043\tp044\tdated\tmutual
r015\tp045\tp046\tdated\tmutual
r016\tp045\tp047\tdated\tmutual
r017\tp041\tp045\tdated\tmutual
r018\tp048\tp049\tdated\tmutual
r019\tp050\tp051\tdated\tmutual
r020\tp041\tp054\tdated\tmutual
r021\tp054\tp055\tdated\tmutual
r022\tp056\tp085\tdated\tmutual
r023\tp060\tp061\tdated\tmutual
r024\tp016\tp064\tdated\tmutual
r025\tp064\tp065\tdated\tmutual
r026\tp021\tp038\tdated\tmutual
r027\tp004\tp092\tdated\tmutual
r028\tp017\tp097\tdated\tmutual
r029\tp015\tp016\tdated\tmutual
r030\tp041\tp042\tdated\tmutual
r031\tp012\tp013\tdated\tmutual
r032\tp043\tp109\tdated\tmutual
r033\tp039\tp040\tdated\tmutual
r034\tp027\tp113\tdated\tmutual
r035\tp020\tp108\tdated\tmutual
r036\tp032\tp045\tdated\tmutual
r037\tp031\tp032\tdated\tmutual
r038\tp032\tp116\tdated\tmutual
r039\tp027\tp028\tdated\tmutual
r040\tp005\tp006\tpartner\tmutual
r041\tp021\tp033\tpartner\tmutual
r042\tp056\tp057\tpartner\tmutual
r043\tp034\tp035\tpartner\tmutual
r044\tp062\tp063\tpartner\tmutual
r045\tp018\tp028\tdated\tmutual
r046\tp052\tp053\tpartner\tmutual
r047\tp038\tp054\tdated\tmutual
r048\tp061\tp066\tpartner\tmutual
r049\tp087\tp088\tdated\tmutual
r050\tp092\tp107\tpartner\tmutual
r051\tp003\tp004\tdated\tmutual
r052\tp058\tp059\tpartner\tmutual
r053\tp110\tp111\tpartner\tmutual
r054\tp037\tp043\tpartner\tmutual
r055\tp084\tp112\tpartner\tmutual
r056\tp041\tp057\tpartner\tmutual
r057\tp105\tp115\tpartner\tmutual
r058\tp017\tp081\tpartner\tmutual
r059\tp069\tp096\tpartner\tmutual
r060\tp001\tp020\taffection\tdirected
r061\tp104\tp105\taffection\tdirected
r062\tp067\tp005\taffection\tdirected
r063\tp067\tp023\taffection\tdirected
r064\tp024\tp076\taffection\tdirected
r065\tp036\tp076\taffection\tdirected
r066\tp106\tp014\taffection\tdirected
r067\tp014\tp033\taffection\tdirected
r068\tp014\tp070\taffection\tdirected
r069\tp070\tp031\taffection\tdirected
r070\tp075\tp084\taffection\tdirected
r071\tp013\tp026\taffection\tdirected
r072\tp074\tp073\taffection\tdirected
r073\tp036\tp072\taffection\tdirected
r074\tp071\tp072\taffection\tdirected
r075\tp075\tp009\taffection\tdirected
r076\tp068\tp069\taffection\tdirected
r077\tp006\tp048\taffection\tdirected
r078\tp006\tp079\taffection\tdirected
r079\tp060\tp062\taffection\tdirected
r080\tp069\tp080\taffection\tdirected
r081\tp081\tp028\taffection\tdirected
r082\tp081\tp054\taffection\tdirected
r083\tp022\tp025\taffection\tdirected
r084\tp016\tp037\taffection\tdirected
r085\tp083\tp020\taffection\tdirected
r086\tp070\tp085\taffection\tdirected
r087\tp082\tp069\taffection\tdirected
r088\tp086\tp014\taffection\tdirected
r089\tp014\tp086\taffection\tdirected
r090\tp089\tp057\taffection\tdirected
r091\tp011\tp023\taffection\tdirected
r092\tp060\tp020\taffection\tdirected
r093\tp086\tp091\taffection\tdirected
r094\tp060\tp017\taffection\tdirected
r095\tp060\tp090\taffection\tdirected
r096\tp077\tp078\taffection\tdirected
r097\tp103\tp078\taffection\tdirected
r098\tp093\tp002\taffection\tdirected
r099\tp095\tp094\taffection\tdirected
r100\tp096\tp051\taffection\tdirected
r101\tp098\tp099\taffection\tdirected
r102\tp100\tp079\taffection\tdirected
r103\tp101\tp102\taffection\tdirected
r104\tp074\tp064\taffection\tdirected
r105\tp114\tp048\taffection\tdirected
r106\tp039\tp048\taffection\tdirected
r107\tp041\tp037\taffection\tdirected
r108\tp088\tp019\taffection\tdirected
`;

const COLORS = Object.freeze({
  男: "#63a4ff",
  女: "#ff6ba8",
});

function rows(value) {
  return value.trim().split("\n").map((row) => row.split("\t"));
}

export const UPSTREAM_PEOPLE = Object.freeze(
  rows(PEOPLE_ROWS).map(([id, name, gender]) => Object.freeze({
    id,
    name,
    gender,
    color: COLORS[gender],
    emoji: name.slice(0, 1),
  })),
);

export const UPSTREAM_RELATIONSHIPS = Object.freeze(
  rows(RELATIONSHIP_ROWS).map(([id, sourceId, targetId, kind, direction]) =>
    Object.freeze({
      id,
      sourceId,
      targetId,
      kind,
      direction,
      startedYear: 1,
      endedYear: null,
      intensity: kind === "partner" ? 5 : kind === "dated" ? 3 : 2,
      note: "",
      visibility: "public",
    })),
);
