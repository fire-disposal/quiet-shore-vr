package com.quietshore.control.protocol

import org.json.JSONObject

/**
 * The questionnaire catalogue.
 *
 * It is **not** a network document. The build emits one JSON file
 * (`dist/questionnaires.json`, a single `{"questionnaires":[…]}` object) from the
 * page's registry and drops the same bytes into both APKs: the headset serves it
 * to the page, the tablet reads it from its assets. Neither end ever ships a
 * question's wording over BLE — the link only ever carries a questionnaire id,
 * a question index and a small answer value, all of which are numbers.
 *
 * That is why this parser takes a whole catalogue rather than a fragment: the
 * file is the registry, and a new instrument is one entry in it plus its clips.
 */
object QuestionnaireCatalogDocument {
    data class Option(val value: Int, val labelZh: String)
    data class Question(val id: String, val textZh: String, val voiceId: String)

    /**
     * How the instrument is scored, as the page declares it.
     *
     * The tablet never applies a transform: it draws this so the operator knows
     * whether a sheet will carry a number, and the page computes the value that
     * arrives on the sheet. An instrument with no `scoring` files `score: null`.
     */
    data class Scoring(val type: String)

    data class Questionnaire(
        val id: String,
        val nameZh: String,
        val shortZh: String,
        val questions: List<Question>,
        val options: List<Option>,
        /** Null when the instrument publishes no score. */
        val scoring: Scoring? = null
    ) {
        /** Every option value this instrument accepts, in ascending order. */
        val optionValues: List<Int> get() = options.map { it.value }

        /** True when [value] is one of this instrument's option values. */
        fun accepts(value: Int): Boolean = options.any { it.value == value }
    }

    /** Furthest an instrument may go: the question grammar's own bound. */
    const val MAX_QUESTIONNAIRES: Int = 16

    /** Bedside instruments are short; the option grammar allows 2..7. */
    private val ID = Regex("^[a-z][a-z0-9-]{0,31}$")

    /**
     * Parses a whole catalogue file.
     *
     * Returns null for a damaged document — one bad instrument refuses the
     * file, because a half-read registry would silently drop the sheet the
     * operator is holding. With no catalogue the tablet shows its empty state,
     * which is honest about what it knows.
     */
    fun parse(json: String): List<Questionnaire>? {
        val array = try {
            JSONObject(json).optJSONArray("questionnaires") ?: return null
        } catch (error: Exception) {
            return null
        }
        if (array.length() !in 1..MAX_QUESTIONNAIRES) {
            return null
        }
        val seen = HashSet<String>()
        val result = ArrayList<Questionnaire>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: return null
            val id = item.optString("id").trim()
            val questions = item.optJSONArray("questions") ?: return null
            val options = item.optJSONArray("options") ?: return null
            if (!ID.matches(id) || !seen.add(id) ||
                questions.length() !in 1..ControlProtocol.QUESTION_MAX ||
                options.length() !in 2..7
            ) {
                return null
            }
            val parsedQuestions = ArrayList<Question>(questions.length())
            for (q in 0 until questions.length()) {
                val question = questions.optJSONObject(q) ?: return null
                val qid = question.optString("id").trim()
                val text = question.optJSONObject("text")?.optString("zh").orEmpty().trim()
                if (!ID.matches(qid) || text.isEmpty() || parsedQuestions.any { it.id == qid }) {
                    return null
                }
                parsedQuestions.add(
                    Question(
                        id = qid,
                        textZh = text,
                        voiceId = question.optString("voiceId").trim()
                    )
                )
            }
            val parsedOptions = ArrayList<Option>(options.length())
            for (o in 0 until options.length()) {
                val option = options.optJSONObject(o) ?: return null
                val value = option.optInt("value", 0)
                val label = option.optJSONObject("label")?.optString("zh").orEmpty().trim()
                if (value !in ControlProtocol.ANSWER_MIN..ControlProtocol.ANSWER_MAX ||
                    label.isEmpty() ||
                    parsedOptions.any { it.value == value }
                ) {
                    return null
                }
                parsedOptions.add(Option(value, label))
            }
            result.add(
                Questionnaire(
                    id = id,
                    nameZh = item.optJSONObject("name")?.optString("zh").orEmpty()
                        .trim().ifEmpty { id },
                    shortZh = item.optJSONObject("short")?.optString("zh").orEmpty().trim(),
                    questions = parsedQuestions,
                    options = parsedOptions.sortedBy { it.value },
                    // Optional: an instrument that declares no scoring files
                    // `score: null`, and the tablet must not invent one.
                    scoring = item.optJSONObject("scoring")
                        ?.optString("type")
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() }
                        ?.let(::Scoring)
                )
            )
        }
        return result
    }
}

/**
 * Reads the catalogue from an APK asset.
 *
 * The same file is compiled into both applications, so the tablet renders the
 * exact registry the page runs — not a second copy that can drift. A missing or
 * damaged asset is an empty catalogue, which the sheet draws as its loading /
 * empty state; the app never falls back to question text of its own.
 */
object QuestionnaireCatalogAsset {
    const val ASSET_NAME: String = "questionnaires.json"

    fun load(open: (String) -> String?): List<QuestionnaireCatalogDocument.Questionnaire> {
        val raw = try {
            open(ASSET_NAME)
        } catch (error: Exception) {
            null
        } ?: return emptyList()
        return QuestionnaireCatalogDocument.parse(raw).orEmpty()
    }
}
