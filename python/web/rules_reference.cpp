// Small functional oracle linked against a separately supplied MIT KataGo tree.
// It does not run a neural network or benchmark search.
#include "game/boardhistory.h"
#include "neuralnet/nninputs.h"
#include "external/nlohmann_json/json.hpp"
#include <iostream>
using json = nlohmann::json;

int main() {
  Board::initHash();
  std::string line;
  while(std::getline(std::cin, line)) {
    try {
      const auto input = json::parse(line);
      int size = input.at("size");
      Board board(size,size);
      auto player = [](const std::string& value) { return value == "B" ? P_BLACK : P_WHITE; };
      for(const auto& stone : input.value("initial",json::array()))
        if(!board.setStone(Location::ofString(stone[1],board),player(stone[0]))) throw std::runtime_error("invalid setup");
      Rules rules = Rules::parseRules(input.value("rules",std::string("chinese")));
      rules.komi = input.value("komi",7.5f);
      BoardHistory hist(board,player(input.value("toPlay",std::string("B"))),rules,0,BoardHistoryModes());
      hist.setAssumeMultipleStartingBlackMovesAreHandicap(false);
      for(const auto& move : input.value("moves",json::array())) {
        auto pla = player(move[0]);
        Loc loc = Location::ofString(move[1],board);
        if(!hist.isLegal(board,loc,pla)) throw std::runtime_error("illegal input move");
        hist.makeBoardMoveAssumeLegal(board,loc,pla,nullptr);
      }
      Color area[Board::MAX_ARR_SIZE];
      hist.getAreaNow(board,area);
      json ownership = json::array(), legal = json::array(), colors = json::array();
      for(int y=0;y<size;y++) for(int x=0;x<size;x++) {
        Loc loc = Location::getLoc(x,y,size);
        ownership.push_back(area[loc] == C_BLACK ? 1 : area[loc] == C_WHITE ? -1 : 0);
        legal.push_back(hist.isLegal(board,loc,hist.presumedNextMovePla));
        colors.push_back(board.colors[loc] == C_BLACK ? "B" : board.colors[loc] == C_WHITE ? "W" : ".");
      }
      legal.push_back(hist.isLegal(board,Board::PASS_LOC,hist.presumedNextMovePla));
      json output = {{"name",input.value("name",std::string())},{"encorePhase",hist.encorePhase},
        {"finished",hist.isGameFinished},{"noResult",hist.isNoResult},{"scoreLead",-hist.finalWhiteMinusBlackScore},
        {"ownership",ownership},{"legal",legal},{"board",colors},{"handicapBonus",hist.whiteHandicapBonusScore}};
      if(input.value("includeFeatures",false)) {
        float spatial[22*361], global[19];
        MiscNNInputParams params;
        params.conservativePassAndIsRoot = input.value("conservativePass",false);
        NNInputs::fillRowV7(board,hist,hist.presumedNextMovePla,params,19,19,false,spatial,global);
        json nonzero = json::array();
        for(int i=0;i<22*361;i++) if(spatial[i] != 0.0f) nonzero.push_back(i);
        output["spatial"] = nonzero;
        output["globalInput"] = global;
        output["passWouldEndPhase"] = hist.passWouldEndPhase(board,hist.presumedNextMovePla);
      }
      std::cout << output.dump() << std::endl;
    } catch(const std::exception& error) { std::cout << json{{"error",error.what()}}.dump() << std::endl; }
  }
}
