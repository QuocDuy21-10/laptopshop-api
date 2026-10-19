const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const createTransferCode = (random: () => number = Math.random) => {
  let suffix = "";
  for (let i = 0; i < 12; i += 1) {
    const index = Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length));
    suffix += ALPHABET[index];
  }
  return `LS${suffix}`;
};
