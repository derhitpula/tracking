// Registry aller Quell-Adapter.
import betmines from './betmines.mjs';
import footballsupertips from './footballsupertips.mjs';
import footyaccumulators from './footyaccumulators.mjs';
import footballpredictions_com from './footballpredictions_com.mjs';
import bettingtips4you from './bettingtips4you.mjs';
import thatsagoal from './thatsagoal.mjs';
import protipster from './protipster.mjs';
import freetips from './freetips.mjs';
import footballtips from './footballtips.mjs';
import soccervista from './soccervista.mjs';
import footballpredictions_net from './footballpredictions_net.mjs';
import soccervital from './soccervital.mjs';
import betclever from './betclever.mjs';

// Schnelle Quellen zuerst; die langsamen Browser-Adapter (Cloudflare-Challenge,
// bis ~4 min Polling) bewusst ans Ende, damit sie den Lauf nicht vorne blockieren.
export const ADAPTERS = [
  betmines, footballsupertips, footyaccumulators, footballpredictions_com,
  bettingtips4you, thatsagoal, protipster, freetips,
  soccervista, footballpredictions_net, soccervital,
  // langsam (echter Browser):
  footballtips, betclever,
];
