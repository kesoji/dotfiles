title: ShellScript
==========
date: 2017-08-17 06:02
tags: []
categories: []
- - -

## Variable
${var#pat}      前方一致での削除(最短マッチ)
${var##pat}     前方一致での削除(最長マッチ)
${var%pat}      後方一致での削除(最短マッチ)
${var%%pat}     後方一致での削除(最長マッチ)

${var/str1/str2}    文字列置換
${var//str1/str2}   文字列置換(/g)

${var:=value}   varが未設定または空ならvalueとして評価されて、 代入される

    HOGEA=a
    echo ${HOGEA:=aiu}
    => a
    echo $HOGEA
    => a

    HOGEB=
    echo ${HOGEB:=aiu}
    => aiu
    echo $HOGEB
    => aiu

    echo ${HOGEC:=aiu}
    => aiu
    echo $HOGEC
    => aiu

${var:+value}   一時的な置き換え

    AAA=aaa
    echo ${AAA:+bbb}
    => bbb
    echo $AAA
    => aaa

${var:-value}   varが未設定または空ならvalueとして評価されるが代入はされない

    HOGEA=a
    echo ${HOGEA:-aiu}
    => a
    echo $HOGEA
    => a

    HOGEB=
    echo ${HOGEB:-aiu}
    => aiu
    echo $HOGEB
    =>  //empty

    echo ${HOGEC:-aiu}
    => aiu
    echo $HOGEC
    =>  //empty

${var:?message} varが未設定または空ならmessageを出力してexit

    EMPTY=
    echo ${EMPTY:wow!}
    => メッセージとともにスクリプト終了


## 制御
if test -f file   ==   if [ -f file ]



## 引数
$1~$9: ポジション。 shiftで移動する
$*: 全部の引数をまとめて1つ
$@: 全部の引数を1つ1つ
