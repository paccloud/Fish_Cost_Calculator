function calculate() {
    var cost = parseFloat(document.getElementById("cost").value);
    var yieldPercent = parseFloat(document.getElementById("yield").value) / 100;
    var processingCost = parseFloat(document.getElementById("processing_cost").value);
    var processor = parseFloat(document.getElementById("processor").value);
    var coldStorage = parseFloat(document.getElementById("cold_storage").value);
    var shipping = parseFloat(document.getElementById("shipping").value);
    var packaging = parseFloat(document.getElementById("packaging").value);
    var weightType = document.getElementById("weight_type").value;

    var result = cost / yieldPercent + processingCost + processor + coldStorage + shipping + packaging;

    if (weightType === "incoming") {
        result += processingCost;
    } else {
        result += processingCost / yieldPercent;
    }

    document.getElementById("result").innerHTML = "Cost per Sellable Pound: $" + result.toFixed(2);
}







function addToTable() {
    var table = document.getElementById("resultsTable").getElementsByTagName('tbody')[0];
    var newRow = table.insertRow(table.rows.length);

    newRow.insertCell(0).innerHTML = document.getElementById("species").value;
    newRow.insertCell(1).innerHTML = document.getElementById("product").value;
    newRow.insertCell(2).innerHTML = document.getElementById("cost").value;
    newRow.insertCell(3).innerHTML = document.getElementById("yield").value;
    newRow.insertCell(4).innerHTML = document.getElementById("processing_cost").value;
    newRow.insertCell(5).innerHTML = document.getElementById("processor").value;
    newRow.insertCell(6).innerHTML = document.getElementById("cold_storage").value;
    newRow.insertCell(7).innerHTML = document.getElementById("shipping").value;
    newRow.insertCell(8).innerHTML = document.getElementById("packaging").value;
    newRow.insertCell(9).innerHTML = document.getElementById("result").innerText.split('$')[1];
}
function exportToCSV() {
    var table = document.getElementById("resultsTable");
    var csv = [];
    var rows = table.querySelectorAll("tr");

    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll("td, th");

        for (var j = 0; j < cols.length; j++) {
            row.push(cols[j].innerText);
        }

        csv.push(row.join(","));
    }

    var csvFile = new Blob([csv.join("\n")], { type: "text/csv" });
    var downloadLink = document.createElement("a");

    downloadLink.href = URL.createObjectURL(csvFile);
    downloadLink.download = 'results.csv';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
function copyToClipboard() {
    var table = document.getElementById("resultsTable");
    var csv = [];
    var rows = table.querySelectorAll("tr");

    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll("td, th");

        for (var j = 0; j < cols.length; j++) {
            row.push(cols[j].innerText);
        }

        csv.push(row.join(","));
    }

    var textArea = document.createElement("textarea");
    textArea.value = csv.join("\n");
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);

    alert("Table data copied to clipboard!");
}
