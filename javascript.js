window.onload = function() {
    populateSpecies();
}

function populateSpecies() {
    const speciesSelect = document.getElementById("species");
    // Clear existing (except first)
    speciesSelect.innerHTML = '<option value="">Select Species</option>';
    
    // Get sorted keys
    const speciesList = Object.keys(FISH_DATA).sort();
    
    speciesList.forEach(sp => {
        let option = document.createElement("option");
        option.value = sp;
        option.text = sp;
        speciesSelect.appendChild(option);
    });
}

function updateProductOptions() {
    const species = document.getElementById("species").value;
    const productSelect = document.getElementById("product");
    productSelect.innerHTML = '<option value="">Select Product</option>';
    
    // Clear Info
    document.getElementById("species-info").innerHTML = "";

    if (species && FISH_DATA[species]) {
        const products = Object.keys(FISH_DATA[species]).sort();
        products.forEach(p => {
            let option = document.createElement("option");
            option.value = p;
            option.text = p;
            productSelect.appendChild(option);
        });
        
        // Show Profile Info if available
        showProfileInfo(species);
    }
}

function showProfileInfo(species) {
    const infoDiv = document.getElementById("species-info");
    if (typeof PROFILES_DATA !== 'undefined' && PROFILES_DATA[species]) {
        const p = PROFILES_DATA[species];
        let html = `<strong>${species} Info:</strong><br>`;
        if (p.description) html += `<em>Description:</em> ${p.description}<br>`;
        if (p.edible_portions) html += `<em>Edible Portions:</em> ${p.edible_portions}<br>`;
        if (p.culinary_uses) html += `<em>Culinary Uses:</em> ${p.culinary_uses}<br>`;
        if (p.url) html += `<a href="${p.url}" target="_blank">Read more at California Sea Grant</a>`;
        infoDiv.innerHTML = html;
    }
}

function updateFields() {
    const species = document.getElementById("species").value;
    const product = document.getElementById("product").value;
    
    if (species && product && FISH_DATA[species] && FISH_DATA[species][product]) {
        const data = FISH_DATA[species][product];
        const yieldVal = data.yield;
        if (yieldVal) {
            document.getElementById("yield").value = yieldVal;
        }
    }
}

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
