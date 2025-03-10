/* eslint-disable prefer-const */
import { BigDecimal, Address } from "@graphprotocol/graph-ts/index";
import { Pair, Token, Bundle } from "../generated/schema";
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from "./utils";
import { log } from "@graphprotocol/graph-ts";

let WBNB_ADDRESS = "0x7c827e6b3ea27b2f726e036d94b2b5ed18da87a9";
let BUSD_WBNB_PAIR = "0x0a5f83af1524936029d5f94da306e62cbf851008"; // created block 307036
let USDT_WBNB_PAIR = "0x2070bea46483aba1f7184c3346d9788f57dd23ab"; // created block 307062

export function getBnbPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdtPair = Pair.load(USDT_WBNB_PAIR); // usdt is token0
  let busdPair = Pair.load(BUSD_WBNB_PAIR); // busd is token1

  if (busdPair !== null && usdtPair !== null) {
    let totalLiquidityBNB = busdPair.reserve0.plus(usdtPair.reserve1);
    if (totalLiquidityBNB.notEqual(ZERO_BD)) {
      let busdWeight = busdPair.reserve0.div(totalLiquidityBNB);
      let usdtWeight = usdtPair.reserve1.div(totalLiquidityBNB);
      return busdPair.token1Price.times(busdWeight).plus(usdtPair.token0Price.times(usdtWeight));
    } else {
      return ZERO_BD;
    }
  } else if (busdPair !== null) {
    return busdPair.token1Price;
  } else if (usdtPair !== null) {
    return usdtPair.token0Price;
  } else {
    return ZERO_BD;
  }
}

// token where amounts should contribute to tracked volume and liquidity
// let WHITELIST: string[] = [
//   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
//   "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
//   "0x55d398326f99059ff775485246999027b3197955", // USDT
//   "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
//   "0x23396cf899ca06c4472205fc903bdb4de249d6fc", // UST
//   "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
//   "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // WETH
// ];
let WHITELIST: string[] = [
  "0x7c827e6b3ea27b2f726e036d94b2b5ed18da87a9", // WBNB
  "0xb3a94227032856b71e522984c79d6de68bef6bca", // BUSD
  "0xebe8262a7111e5acd0e5de8675f49f35842044db", // USDT
  // "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  // "0x23396cf899ca06c4472205fc903bdb4de249d6fc", // UST
  // "0x43f5e794c6167a7bdea2cb930458fb0ae63593bf", // BTCB
  "0x7eda29098b5974fd9d1b73bac4167360d489772e", // WETH
  // "0x25cede3b006a9779c65d834ce26cb5d6eb385f24", // XRP
];

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_BNB = BigDecimal.fromString("10");

/**
 * Search through graph to find derived BNB per token.
 * @todo update to be derived BNB (add stablecoin estimates)
 **/
export function findBnbPerToken(token: Token): BigDecimal {
  if (token.id == WBNB_ADDRESS) {
    return ONE_BD;
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]));
    if (pairAddress.toHex() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHex());
      if (pair) {
        if (pair.token0 == token.id && pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)) {
          let token1 = Token.load(pair.token1);
          return pair.token1Price.times(token1!.derivedBNB! || BigDecimal.fromString("0")); // return token1 per our token * BNB per token 1
        }
        if (pair.token1 == token.id && pair.reserveBNB.gt(MINIMUM_LIQUIDITY_THRESHOLD_BNB)) {
          let token0 = Token.load(pair.token0);
          return pair.token0Price.times(token0!.derivedBNB! || BigDecimal.fromString("0")); // return token0 per our token * BNB per token 0
        }
      }
    }
  }
  return ZERO_BD; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0!.derivedBNB!.times(bundle.bnbPrice) || BigDecimal.fromString("0");
  let price1 = token1!.derivedBNB!.times(bundle.bnbPrice) || BigDecimal.fromString("0");

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1)).div(BigDecimal.fromString("2"));
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0);
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1);
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  bundle: Bundle,
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0!.derivedBNB!.times(bundle.bnbPrice) || BigDecimal.fromString("0");
  let price1 = token1!.derivedBNB!.times(bundle.bnbPrice) || BigDecimal.fromString("0");

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}
