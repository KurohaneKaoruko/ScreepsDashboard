export interface OfficialMarketResourceAsset {
  code: string;
  displayName: string;
  iconPath?: string;
  iconScale?: number;
}

export const OFFICIAL_MARKET_ASSET_BASE_URL = "https://screeps.com/a";
export const LOCAL_MARKET_ASSET_BASE_PATH = "/screeps-market-svgs";

const LOCAL_MARKET_ICON_FILE_BY_CODE_LOWER: Readonly<Record<string, string>> = {
  token: "resource-credits.svg",
  cpuunlock: "official-cpu-unlock.svg",
  accesskey: "official-access-key.svg",
  pixel: "official-pixel.svg",
  alloy: "1-brown.svg",
  tube: "2-brown.svg",
  fixtures: "3-brown.svg",
  frame: "4-brown.svg",
  hydraulics: "5-brown.svg",
  machine: "6-brown.svg",
  cell: "1-green.svg",
  phlegm: "2-green.svg",
  tissue: "3-green.svg",
  muscle: "4-green.svg",
  organoid: "5-green.svg",
  organism: "6-green.svg",
  wire: "1-blue.svg",
  switch: "2-blue.svg",
  transistor: "3-blue.svg",
  microchip: "4-blue.svg",
  circuit: "5-blue.svg",
  device: "6-blue.svg",
  condensate: "1-purple.svg",
  concentrate: "2-purple.svg",
  extract: "3-purple.svg",
  spirit: "4-purple.svg",
  emanation: "5-purple.svg",
  essence: "6-purple.svg",
};

function inferLocalIconFileName(resourceCode: string): string | undefined {
  const key = resourceCode.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  const mapped = LOCAL_MARKET_ICON_FILE_BY_CODE_LOWER[key];
  if (mapped) {
    return mapped;
  }
  return `${key}.svg`;
}

export const OFFICIAL_MARKET_RESOURCE_ASSETS: readonly OfficialMarketResourceAsset[] = [
  { code: "token", displayName: "Subscription token", iconPath: "app2/token.8b4544866bc6ff19824e.svg" },
  {
    code: "cpuUnlock",
    displayName: "Cpu Unlock",
    iconPath: "app2/unlock-animate.532e0fbe0dcfe5a812da.svg",
    iconScale: 1,
  },
  {
    code: "pixel",
    displayName: "Pixel",
    iconPath: "app2/pixels-animate.226a85891eff7a8a5f32.svg",
    iconScale: 1,
  },
  {
    code: "accessKey",
    displayName: "Access Key",
    iconPath: "app2/keys-animate.912b7f9cbc3480d79223.svg",
    iconScale: 1,
  },
  { code: "energy", displayName: "Energy", iconPath: "app2/energy.b2b1276123948135a3f6.svg", iconScale: 0.65 },
  { code: "power", displayName: "Power", iconPath: "app2/power.3121de2f0efbbe34538a.svg", iconScale: 0.65 },
  { code: "metal", displayName: "Metal", iconPath: "app2/metal.d2e528eedb85e7c4dfc2.svg" },
  { code: "biomass", displayName: "Biomass", iconPath: "app2/biomass.64d16ed412ff1da05d05.svg" },
  { code: "silicon", displayName: "Silicon", iconPath: "app2/silicon.cd91f1f6ca22ff32ed84.svg" },
  { code: "mist", displayName: "Mist", iconPath: "app2/mist.5d20332e9e4b870a229c.svg" },
  { code: "ops", displayName: "Ops", iconPath: "app2/ops.2325cdadb6c5e2aa3730.svg", iconScale: 0.65 },
  { code: "composite", displayName: "Composite", iconPath: "app2/composite.5064c5181b89769c5537.svg", iconScale: 0.45 },
  { code: "crystal", displayName: "Crystal", iconPath: "app2/crystal.5f79f7294759307f3353.svg", iconScale: 0.45 },
  { code: "liquid", displayName: "Liquid", iconPath: "app2/liquid.125b3d369717316de8fd.svg", iconScale: 0.45 },
  { code: "utrium_bar", displayName: "Utrium bar", iconPath: "app2/utrium_bar.7a0ee4a8288432f48ce7.svg", iconScale: 0.65 },
  { code: "lemergium_bar", displayName: "Lemergium bar", iconPath: "app2/lemergium_bar.2a4ce11cd9d2d9fafdc4.svg", iconScale: 0.65 },
  { code: "zynthium_bar", displayName: "Zynthium bar", iconPath: "app2/zynthium_bar.625febd309a2dbb79845.svg", iconScale: 0.65 },
  { code: "keanium_bar", displayName: "Keanium bar", iconPath: "app2/keanium_bar.bcbd500dcfae922e1d65.svg", iconScale: 0.65 },
  { code: "ghodium_melt", displayName: "Ghodium melt", iconPath: "app2/ghodium_melt.577243405ad02b08cbb2.svg", iconScale: 0.65 },
  { code: "oxidant", displayName: "Oxidant", iconPath: "app2/oxidant.beb1af14300e130ee4a8.svg", iconScale: 0.65 },
  { code: "reductant", displayName: "Reductant", iconPath: "app2/reductant.ccbea77a91307098fbe9.svg", iconScale: 0.65 },
  { code: "purifier", displayName: "Purifier", iconPath: "app2/purifier.bc25752f5e5c6d1852b2.svg", iconScale: 0.65 },
  { code: "battery", displayName: "Battery", iconPath: "app2/battery.c436d54eea68f4c3728c.svg", iconScale: 0.45 },
  { code: "alloy", displayName: "Alloy", iconPath: "app2/1.f99f01f874144ddb2133.svg", iconScale: 0.65 },
  { code: "tube", displayName: "Tube", iconPath: "app2/2.819e19287297dc537e84.svg", iconScale: 0.65 },
  { code: "fixtures", displayName: "Fixtures", iconPath: "app2/3.49564e9bf3fbff82c90e.svg", iconScale: 0.65 },
  { code: "frame", displayName: "Frame", iconPath: "app2/4.ff1e1a5db813f5571a18.svg", iconScale: 0.65 },
  { code: "hydraulics", displayName: "Hydraulics", iconPath: "app2/5.8f0e485514af5fe256d3.svg", iconScale: 0.65 },
  { code: "machine", displayName: "Machine", iconPath: "app2/6.c1f1c1b95a4032cb99e0.svg", iconScale: 0.65 },
  { code: "cell", displayName: "Cell", iconPath: "app2/1.8699dc6ad5d69632ea7c.svg", iconScale: 0.65 },
  { code: "phlegm", displayName: "Phlegm", iconPath: "app2/2.5328d7f3bae8cc982cd4.svg", iconScale: 0.65 },
  { code: "tissue", displayName: "Tissue", iconPath: "app2/3.b8e1ce3593eaaed0363a.svg", iconScale: 0.65 },
  { code: "muscle", displayName: "Muscle", iconPath: "app2/4.133b1ab15d29395d0622.svg", iconScale: 0.65 },
  { code: "organoid", displayName: "Organoid", iconPath: "app2/5.b154ce7858bda4629183.svg", iconScale: 0.65 },
  { code: "organism", displayName: "Organism", iconPath: "app2/6.0550eaed3d48497a0e86.svg", iconScale: 0.65 },
  { code: "wire", displayName: "Wire", iconPath: "app2/1.85afcb246004ad330a8a.svg", iconScale: 0.65 },
  { code: "switch", displayName: "Switch", iconPath: "app2/2.39e2d01fa7ab71e223e2.svg", iconScale: 0.65 },
  { code: "transistor", displayName: "Transistor", iconPath: "app2/3.e776ac05297668c2d7f1.svg", iconScale: 0.65 },
  { code: "microchip", displayName: "Microchip", iconPath: "app2/4.10ade84f052d72b44261.svg", iconScale: 0.65 },
  { code: "circuit", displayName: "Circuit", iconPath: "app2/5.b768a2d13b1a24b3b303.svg", iconScale: 0.65 },
  { code: "device", displayName: "Device", iconPath: "app2/6.6f3f8a8e3b9550037606.svg", iconScale: 0.65 },
  { code: "condensate", displayName: "Condensate", iconPath: "app2/1.ee0452b10eb8b19583fc.svg", iconScale: 0.65 },
  { code: "concentrate", displayName: "Concentrate", iconPath: "app2/2.63b80e87149ffb46a8ce.svg", iconScale: 0.65 },
  { code: "extract", displayName: "Extract", iconPath: "app2/3.2c27e5551c9e1ab884e8.svg", iconScale: 0.65 },
  { code: "spirit", displayName: "Spirit", iconPath: "app2/4.f510a505f120747f8618.svg", iconScale: 0.65 },
  { code: "emanation", displayName: "Emanation", iconPath: "app2/5.9c17a88ec9401400ae84.svg", iconScale: 0.65 },
  { code: "essence", displayName: "Essence", iconPath: "app2/6.c395b801a5f8d81343a1.svg", iconScale: 0.65 },
  { code: "O", displayName: "Oxygen", iconPath: "app2/o.fe657c9afbe77803285d.svg" },
  { code: "H", displayName: "Hydrogen", iconPath: "app2/h.916943b56cbfa8b46c59.svg" },
  { code: "Z", displayName: "Zynthium", iconPath: "app2/z.e8a850a8709cd1c67b3c.svg" },
  { code: "K", displayName: "Keanium", iconPath: "app2/k.d0bba8fc5e0ed9dc9d8b.svg" },
  { code: "U", displayName: "Utrium", iconPath: "app2/u.5b7c24690cf18b6071b7.svg" },
  { code: "L", displayName: "Lemergium", iconPath: "app2/l.e555b41bf0c148cf0f9c.svg" },
  { code: "X", displayName: "Catalyst", iconPath: "app2/x.cfe3f659269543ecdf5e.svg" },
  { code: "OH", displayName: "Hydroxide", iconPath: "app2/oh.68538ef1b721cee8200a.svg" },
  { code: "ZK", displayName: "Zynthium Keanite", iconPath: "app2/zk.c1342dac48b57b32fad4.svg" },
  { code: "UL", displayName: "Utrium Lemergite", iconPath: "app2/ul.91029fa8a1d4b18bf504.svg" },
  { code: "G", displayName: "Ghodium", iconPath: "app2/g.3eee08abb3011f1bb5d3.svg" },
  { code: "KH", displayName: "Keanium Hydride", iconPath: "app2/kh.20e9d456a133b925e86f.svg" },
  { code: "KH2O", displayName: "Keanium Acid", iconPath: "app2/kh2o.11669bd949f22f3d120d.svg" },
  { code: "XKH2O", displayName: "Catalyzed Keanium Acid", iconPath: "app2/xkh2o.96d6d3cbc3dd1b9499dc.svg" },
  { code: "KO", displayName: "Keanium Oxide", iconPath: "app2/ko.5f77bbc0746abb24a431.svg" },
  { code: "KHO2", displayName: "Keanium Alkalide", iconPath: "app2/kho2.0ae161df55fe0e2d5ab2.svg" },
  { code: "XKHO2", displayName: "Catalyzed Keanium Alkalide", iconPath: "app2/xkho2.764e6060a08188b6c36a.svg" },
  { code: "UH", displayName: "Utrium Hydride", iconPath: "app2/uh.ebe328efd9260f585125.svg" },
  { code: "UH2O", displayName: "Utrium Acid", iconPath: "app2/uh2o.273de081b351a6de38bf.svg" },
  { code: "XUH2O", displayName: "Catalyzed Utrium Acid", iconPath: "app2/xuh2o.4235eff312366e93feda.svg" },
  { code: "UO", displayName: "Utrium Oxide", iconPath: "app2/uo.af8ee9aeeddf3ab8f368.svg" },
  { code: "UHO2", displayName: "Utrium Alkalide", iconPath: "app2/uho2.d383e11c418eb215bcfc.svg" },
  { code: "XUHO2", displayName: "Catalyzed Utrium Alkalide", iconPath: "app2/xuho2.59b58fa64d9dd7814a48.svg" },
  { code: "LH", displayName: "Lemergium Hydride", iconPath: "app2/lh.0c60c6e53a348f28170a.svg" },
  { code: "LH2O", displayName: "Lemergium Acid", iconPath: "app2/lh2o.caa7ea8c9a74f0a20827.svg" },
  { code: "XLH2O", displayName: "Catalyzed Lemergium Acid", iconPath: "app2/xlh2o.cc37f0b2f01c56e4d899.svg" },
  { code: "LO", displayName: "Lemergium Oxide", iconPath: "app2/lo.7b4fb227677c120f9114.svg" },
  { code: "LHO2", displayName: "Lemergium Alkalide", iconPath: "app2/lho2.c2797604002cb74a25f9.svg" },
  { code: "XLHO2", displayName: "Catalyzed Lemergium Alkalide", iconPath: "app2/xlho2.9f8a834e1a94a090c506.svg" },
  { code: "ZH", displayName: "Zynthium Hydride", iconPath: "app2/zh.1fdb30a2bef3e92161a5.svg" },
  { code: "ZH2O", displayName: "Zynthium Acid", iconPath: "app2/zh2o.9b84dc06d87f69c8481e.svg" },
  { code: "XZH2O", displayName: "Catalyzed Zynthium Acid", iconPath: "app2/xzh2o.d635f74be224cc143ee9.svg" },
  { code: "ZO", displayName: "Zynthium Oxide", iconPath: "app2/zo.e4635f3dc127663bbe95.svg" },
  { code: "ZHO2", displayName: "Zynthium Alkalide", iconPath: "app2/zho2.2df4a5452d497590563e.svg" },
  { code: "XZHO2", displayName: "Catalyzed Zynthium Alkalide", iconPath: "app2/xzho2.9d2c84376cc12773f80e.svg" },
  { code: "GH", displayName: "Ghodium Hydride", iconPath: "app2/gh.fe1d11fc08a207e995bc.svg" },
  { code: "GH2O", displayName: "Ghodium Acid", iconPath: "app2/gh2o.32c0afd9a6ddc15a24e0.svg" },
  { code: "XGH2O", displayName: "Catalyzed Ghodium Acid", iconPath: "app2/xgh2o.9b85ae3c193192a4eeb4.svg" },
  { code: "GO", displayName: "Ghodium Oxide", iconPath: "app2/go.e384ede4047c952bb083.svg" },
  { code: "GHO2", displayName: "Ghodium Alkalide", iconPath: "app2/gho2.2d79082f08c2415ffe9d.svg" },
  { code: "XGHO2", displayName: "Catalyzed Ghodium Alkalide", iconPath: "app2/xgho2.5238134b30f12eb0791c.svg" },
];

const OFFICIAL_MARKET_RESOURCE_ASSET_BY_LOWER = new Map<string, OfficialMarketResourceAsset>(
  OFFICIAL_MARKET_RESOURCE_ASSETS.map((asset) => [asset.code.toLowerCase(), asset])
);

export function getOfficialMarketResourceAsset(resourceType: string): OfficialMarketResourceAsset | undefined {
  const key = resourceType.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  return OFFICIAL_MARKET_RESOURCE_ASSET_BY_LOWER.get(key);
}

export function getOfficialMarketResourceIconUrl(resourceType: string): string | undefined {
  const asset = getOfficialMarketResourceAsset(resourceType);
  const localFileName = inferLocalIconFileName(asset?.code ?? resourceType);
  if (localFileName) {
    return `${LOCAL_MARKET_ASSET_BASE_PATH}/${encodeURIComponent(localFileName)}`;
  }
  if (asset?.iconPath) {
    return `${OFFICIAL_MARKET_ASSET_BASE_URL}/${asset.iconPath}`;
  }
  return undefined;
}
