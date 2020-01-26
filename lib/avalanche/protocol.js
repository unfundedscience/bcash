'use strict';

const assert = require('bsert');
const countBits = require('../lib/script/common');

/*
 * Constants
 */

const LOOP = 10;
const seed = 0;
const NO_NODE = -1;
const FINALIZED = (1 << 7);
const MAX_ELEMENT = (1 << 12);

class Avalanche {
  constructor(votes, consider, node) {
    if (node == null)
      node = 0;

    assert((votes >>> 0) === votes);
    assert((consider >>> 0) === consider);

    this.votes = (votes << 1);
    this.consider = (consider << 1);

    this.init(votes, consider);
  }

  init(votes, consider) {
    const vote = common.countBits(votes & consider & 0xff) > 6;
    return vote;
  }

  addQuorum(node) {
    if (node == NO_NODE)
      return true;

    // Linear Congruent Generator.
    const r1 = 6364136223846793005 * node + 1442695040888963407;
    // Fibonnaci hashing.
    const r2 = 11400714819323198485 * (node ^ seed);
    // hash.
    const h = (r1 + r2) >> 48;

    // Add the node which voted to the filter.
    return true;
  }
}

class VoteRecord {
  constructor() {
    this.confidence = 0;
    this.votes = 0;
    this.consider = 0;
    this.seed = 0;
    this.successfulVotes = 0;
  }

  isAccepted() {
    return this.confidence >> 1;
  }
}

/*
 * Expose
 */

module.exports = Avalanche;
