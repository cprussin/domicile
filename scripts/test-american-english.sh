#!/usr/bin/env bash
# Fails on British spellings in tracked files and filenames. See AGENTS.md.
#
# Uses a fixed list of British forms (`-our`, `-re`, `-ise`, doubled `-ll-`
# and some one-off words) instead of a spell checker: the list is easy to
# review and needs nothing installed.
#
# Reads tracked files only, so untracked files cannot fail the run.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Whole words, case insensitive. Only forms that are never American: the
# `-ise` and `-ll-` families are listed word by word because suffix patterns
# would match `advertise`, `promise` and `controller`.
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

# Other projects' APIs: Nix's `--realise` flag and GitHub's `cancelled()`.
# Only those exact forms are exempt.
EXEMPT='--realise\b|\bcancelled\(\)'

# Skip binaries, lockfiles, this file (it contains the list) and the vendored
# IANA TLD list (`.theatre` is a real TLD).
SELF="scripts/$(basename "$0")"
TLDS="packages/shell-manganese/src/address/tlds.ts"
FILES="$(git ls-files \
  | grep -vE '\.(lock|png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|svg)$' \
  | grep -vxF -e "$SELF" -e "$TLDS")"
[ -n "$FILES" ] || {
  echo "SKIP: no tracked files to read — not a checkout?"
  exit 77
}

# `grep -I` skips binary files missed by the extension filter. Exempt lines
# are filtered after matching so the exemption stays in one place.
HITS="$(printf '%s\n' "$FILES" \
  | xargs grep -InEi -- "$BRITISH" 2>/dev/null \
  | grep -vE -- "$EXEMPT" || true)"

# Filenames too, not only contents.
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
