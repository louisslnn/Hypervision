declare module "stockfish" {
  type StockfishModule = () => {
    postMessage: (message: string) => void;
    onmessage?: (event: { data: string }) => void;
    terminate?: () => void;
  };

  const Stockfish: StockfishModule;
  export default Stockfish;
}

declare module "stockfish/src/stockfish-17.1-lite-single-03e3232.js" {
  type StockfishModule = () => {
    postMessage: (message: string) => void;
    onmessage?: (event: { data: string }) => void;
    terminate?: () => void;
  };

  const Stockfish: StockfishModule;
  export default Stockfish;
}
