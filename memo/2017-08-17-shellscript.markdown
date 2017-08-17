title: ShellScript
==========
date: 2017-08-17 06:02
tags: []
categories: []
- - -

${var#pat}      前方一致での削除(最短マッチ)
${var##pat}     前方一致での削除(最長マッチ)
${var%pat}      後方一致での削除(最短マッチ)
${var%%pat}     後方一致での削除(最長マッチ)

${var/str1/str2}    文字列置換
${var//str1/str2}   文字列置換(/g)
