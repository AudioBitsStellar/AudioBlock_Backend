export const ArtistFacetV2ABI = [
  { inputs: [], name: "ARTIST_ALREADY_REGISTERED", type: "error" },
  { inputs: [], name: "ZeroAddress", type: "error" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "artistId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "artistAddress",
        type: "address",
      },
    ],
    name: "ArtistRegistered",
    type: "event",
  },
  {
    inputs: [],
    name: "setupArtistProfile",
    outputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];
