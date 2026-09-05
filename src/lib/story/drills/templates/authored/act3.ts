import { parseCards } from '@/lib/poker/card-notation';
import type { DrillTemplate } from '../../types';
export const ACT3_AUTHORED_DRILLS: readonly DrillTemplate[] = [{
 id:'act-ch09-checkraise-fold',category:'action-judgment',title:'체크 뒤의 레이즈',difficulty:3,hints:['내 약한 원페어가 명시된 밸류 레인지에 이기는 조합을 세어 봐.'],source:{kind:'authored',instance:{
  category:'action-judgment',situation:{hero:parseCards('9h 8s'),board:parseCards('Kc 9d 7s 4h 2c'),potChips:700,toCallChips:300,bigBlind:20,heroStackChips:1800,heroPosition:'BTN',street:'river',villains:[{seatIndex:1,characterId:'luna',position:'BB',stackChips:1500,range:'KK, 99, 77'}],note:'리버 시작 팟 200. 루나 체크 → 내 100 벳 → 루나 총 400 레이즈. 루나가 이 라인에서 KK/99/77만 레이즈하고 블러프는 없다고 가정해. 실제 패는 공개하지 않아.'},
  question:'명시된 레인지 가정에서 약한 원페어의 결정은?',answerSpec:{kind:'action-pick',options:['fold','call','raise'],correct:['fold']},hint:'이기는 조합이 없고 콜에는 30% 승률이 필요해.',explanation:{speaker:'elena',text:'…폴드. 알려진 카드를 빼면 KK 3, 99 1, 77 3으로 일곱 조합. 모두 세트라서 원페어는 이기지 못해. 필요한 승률은 300 ÷ (700 + 300) = 30%. 블러프가 없다는 명시적 가정의 답이야. 모든 체크레이즈가 세트라는 뜻은 아니야.',facts:{combos:7,equity:0,requiredEquity:30}},
 }},
}];
