#!/usr/bin/env bash
# Whether anything written here is spelled the British way.
#
# The repo is American English throughout — prose, comments, identifiers and
# test names alike. That is not a taste: an agent reads this tree before it
# writes, so whichever spelling is in it is the spelling that comes back out,
# and a tree holding both teaches both. One sweep put 155 lines right; without
# something that says so, the next session puts a few back.
#
# What it looks for is a list of British forms, not a dictionary: the four
# families that actually appear in technical prose (`-our`, `-re`, `-ise` and
# the doubled `-ll-`) plus the handful of one-off words. A list is checkable by
# reading it, which a spell checker with a 40,000-word corpus and a project
# wordlist is not, and it has no dependency to install on a runner.
#
# It reads tracked files only, so a scratch file or a vendored checkout in the
# working tree cannot fail a run that has nothing to do with it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# One extended regex, whole words, case insensitive. Each alternative is a form
# that is *only* British: `colour` is here and `color` is not, `centre` is here
# and `center` is not. Anything that is also a correct American word stays out
# — `advertise`, `promise` and `controller` all end in letters this would
# otherwise catch, which is why the `-ise` and `-ll-` families are listed word
# by word rather than as a suffix pattern.
BRITISH='\b('\
'colour|colours|coloured|colouring|colourful|'\
'behaviour|behaviours|favour|favours|favoured|favourite|favourites|'\
'honour|honours|honoured|honouring|labour|labours|neighbour|neighbours|'\
'neighbouring|neighbourhood|rumour|rumours|flavour|flavours|vapour|armour|harbour|'\
'centre|centres|centred|centring|fibre|fibres|litre|litres|metre|metres|'\
'millimetre|millimetres|centimetre|centimetres|kilometre|kilometres|'\
'theatre|calibre|lustre|sabre|sombre|spectre|manoeuvre|manoeuvres|'\
'analyse|analyses|analysed|analysing|paralyse|paralysed|catalyse|catalysed|'\
'initialise|initialises|initialised|initialising|initialisation|'\
'uninitialised|serialise|serialised|serialisation|deserialise|deserialised|'\
'normalise|normalised|normalisation|optimise|optimises|optimised|optimising|'\
'optimisation|optimisations|organise|organises|organised|organising|'\
'organisation|organisations|realise|realises|realised|realising|'\
'recognise|recognises|recognised|recognising|recognisable|'\
'maximise|maximises|maximised|maximising|minimise|minimises|minimised|'\
'minimising|synchronise|synchronised|synchronisation|prioritise|prioritised|'\
'specialise|specialised|standardise|standardised|summarise|summarised|'\
'utilise|utilised|visualise|visualised|customise|customised|categorise|'\
'categorised|authorise|authorised|capitalise|capitalised|finalise|finalised|'\
'localise|localised|rasterise|rasterised|rasteriser|tokenise|tokenised|'\
'sanitise|sanitised|apologise|apologised|emphasise|emphasised|itemise|itemised|'\
'cancelled|cancelling|labelled|labelling|relabelled|relabelling|'\
'modelled|modelling|signalled|signalling|travelled|travelling|traveller|'\
'levelled|levelling|fuelled|fuelling|panelled|totalled|totalling|'\
'marvellous|counsellor|counsellors|jeweller|jewellery|'\
'defence|defences|offence|offences|licence|licences|pretence|'\
'practise|practises|practised|practising|programme|programmes|'\
'grey|greys|greyed|greyish|anticlockwise|'\
'aluminium|sulphur|storey|storeys|kerb|tyre|tyres|plough|moustache|'\
'mould|moulded|moulding|smoulder|smouldering|cosy|pyjamas|aeroplane|cheque|'\
'draught|draughts|judgement|judgements|acknowledgement|acknowledgements|'\
'ageing|enrol|enrols|instalment|instalments|fulfil|fulfils|skilful|wilful|'\
'whilst|amongst|learnt|spelt|misspelt|burnt|dreamt|leapt|orientated|'\
'speciality|specialities|sceptic|sceptical|scepticism|maths|'\
'anaesthetic|archaeology|archaeological|encyclopaedia|mediaeval|'\
'foetus|oesophagus|oestrogen|orthopaedic|paediatric|haemoglobin|leukaemia'\
')\b'

# `nix-store --realise` is Nix's flag and `cancelled()` is GitHub's. Spelled
# the American way, neither runs -- so the line is exempt rather than the
# word, which keeps both caught everywhere else.
EXEMPT='--realise\b|\bcancelled\(\)'

# Binaries and lockfiles have nothing to read and are megabytes of it. This
# file goes too, and has to: the list above is sixty British words, so a check
# that read itself would fail on the thing that defines failing.
SELF="scripts/$(basename "$0")"
FILES="$(git ls-files \
  | grep -vE '\.(lock|png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|svg)$' \
  | grep -vxF "$SELF")"
[ -n "$FILES" ] || {
  echo "SKIP: no tracked files to read — not a checkout?"
  exit 77
}

# `grep -I` drops anything that turns out to be binary despite the extension.
# The exempt lines go out after the match rather than before, so the exemption
# is visible in one place instead of being folded into the pattern above.
HITS="$(printf '%s\n' "$FILES" \
  | xargs grep -InEi -- "$BRITISH" 2>/dev/null \
  | grep -vE -- "$EXEMPT" || true)"

# Filenames as well as contents. The sweep that came before this found one in a
# script's own name, where nothing reading file contents would ever have looked.
NAMES="$(printf '%s\n' "$FILES" | grep -Ei -- "$BRITISH" || true)"

if [ -z "$HITS" ] && [ -z "$NAMES" ]; then
  echo "ok: no British spellings in $(printf '%s\n' "$FILES" | wc -l) tracked files"
  exit 0
fi

echo "British spellings found. This repo is American English throughout."
echo
[ -n "$NAMES" ] && { echo "in filenames:"; printf '  %s\n' $NAMES; echo; }
[ -n "$HITS" ] && printf '%s\n' "$HITS"
exit 1
